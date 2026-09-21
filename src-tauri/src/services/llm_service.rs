//! OpenAI Chat Completions 兼容的技能简介处理服务。
//! 原始技能描述只用于单次请求，不写日志；API Key 仅保存到系统凭据库。

use std::borrow::Cow;
use std::time::Duration;

use anyhow::{anyhow, Result};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::db::Database;
use crate::types::{
    DescriptionProcessingFailure, DescriptionProcessingResult, LlmConfig, LlmConfigInput,
    LlmConnectionTest, SkillRecord,
};

const STATUS_READY: &str = "ready";
const STATUS_FAILED: &str = "failed";
const REQUEST_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    /// 不设 token 上限：None 时整个字段不发送，由模型/服务端默认预算决定。
    /// 思考模型会把大量预算用在推理上，客户端设上限会掐断正式输出
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u16>,
}

#[derive(Debug, Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: Cow<'a, str>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
    /// 截断/停止原因；content 为空时用于定位（length 常见于推理模型烧光预算）
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
    /// 推理模型（deepseek-reasoner / o1 等）把正式输出前的思考放在这里；
    /// content 为空时可用它证明链路连通（仅连接测试允许）
    #[serde(default)]
    reasoning_content: Option<String>,
}

pub struct LlmService;

impl LlmService {
    /// 校验调用方传入的 API Key（非空即通过；不做持久化）
    fn require_api_key(api_key: &str) -> Result<String> {
        let key = api_key.trim();
        if key.is_empty() {
            return Err(anyhow!("请先填写 API Key"));
        }
        Ok(key.to_string())
    }

    fn normalize_base_url(raw: &str) -> Result<String> {
        let mut url = Url::parse(raw.trim()).map_err(|_| anyhow!("Base URL 格式无效"))?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
            return Err(anyhow!("Base URL 必须是有效的 http 或 https 地址"));
        }
        if url
            .path()
            .trim_end_matches('/')
            .ends_with("/chat/completions")
        {
            return Err(anyhow!(
                "请填写 API Base URL，而非 /chat/completions 完整地址"
            ));
        }
        url.set_query(None);
        url.set_fragment(None);
        Ok(url.to_string().trim_end_matches('/').to_string())
    }

    fn validate_input(input: &LlmConfigInput) -> Result<(String, String, String)> {
        let provider_name = input.provider_name.trim();
        let model = input.model.trim();
        if provider_name.is_empty() || provider_name.chars().count() > 64 {
            return Err(anyhow!("提供商名称不能为空且不得超过 64 个字符"));
        }
        if model.is_empty() || model.chars().count() > 256 {
            return Err(anyhow!("模型名称不能为空且不得超过 256 个字符"));
        }
        Ok((
            provider_name.to_string(),
            Self::normalize_base_url(&input.base_url)?,
            model.to_string(),
        ))
    }

    fn completion_url(base_url: &str) -> Result<Url> {
        let mut url = Url::parse(base_url).map_err(|_| anyhow!("Base URL 格式无效"))?;
        let base_path = url.path().trim_end_matches('/');
        url.set_path(&format!("{base_path}/chat/completions"));
        Ok(url)
    }

    pub fn get_config(db: &Database) -> Result<LlmConfig> {
        Ok(LlmConfig {
            provider_name: db.get_setting("llm_provider_name")?.unwrap_or_default(),
            base_url: db.get_setting("llm_base_url")?.unwrap_or_default(),
            model: db.get_setting("llm_model")?.unwrap_or_default(),
            language: db.get_setting("llm_language")?.unwrap_or_else(|| "zh".to_string()),
        })
    }

    pub fn save_config(db: &Database, input: LlmConfigInput) -> Result<LlmConfig> {
        let (provider_name, base_url, model) = Self::validate_input(&input)?;
        db.set_setting("llm_provider_name", &provider_name)?;
        db.set_setting("llm_base_url", &base_url)?;
        db.set_setting("llm_model", &model)?;
        if let Some(lang) = input.language.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
            let normalized_lang = if lang == "en" { "en" } else { "zh" };
            db.set_setting("llm_language", normalized_lang)?;
        }
        if let Some(key) = input.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            db.set_setting("llm_api_key", key)?;
        }
        Self::get_config(db)
    }

    /// 从聊天响应提取文本：content 优先；content 为空且允许回退时读
    /// reasoning_content（推理模型的思考链，仅连接测试用来证明链路连通）。
    /// 两者皆空时报错并带上 finish_reason 便于定位
    fn extract_content(parsed: ChatResponse, allow_reasoning_fallback: bool) -> Result<String> {
        let Some(choice) = parsed.choices.into_iter().next() else {
            return Err(anyhow!("LLM 返回了空的 choices 列表"));
        };
        let finish_reason = choice
            .finish_reason
            .clone()
            .unwrap_or_else(|| "未知".to_string());
        let content_empty = choice
            .message
            .content
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty();
        let content = if content_empty {
            if allow_reasoning_fallback {
                choice.message.reasoning_content.clone()
            } else {
                None
            }
        } else {
            choice.message.content.clone()
        };
        content
            .filter(|content| !content.trim().is_empty())
            .ok_or_else(|| {
                anyhow!(
                    "LLM 未返回文本内容（finish_reason={finish_reason}）。\
                     若使用的是推理模型（deepseek-reasoner / o1 等），\
                     请改用普通对话模型（如 deepseek-chat）"
                )
            })
    }

    fn is_reasoning_or_special_model(model: &str) -> bool {
        let m = model.to_lowercase();
        m.contains("reasoner") || m.starts_with("o1") || m.starts_with("o3")
    }

    async fn chat_completion(
        base_url: &str,
        model: &str,
        api_key: &str,
        system: &str,
        user: &str,
        max_tokens: Option<u16>,
        // 允许在 content 为空时回退读 reasoning_content（仅连接测试）：
        // 描述生成必须用正式 content，思考链不能当简介
        allow_reasoning_fallback: bool,
    ) -> Result<String> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()?;
        let endpoint = Self::completion_url(base_url)?;

        let is_reasoning = Self::is_reasoning_or_special_model(model);
        let mut use_system = !is_reasoning;
        let mut send_temperature = !is_reasoning;

        for attempt in 0..2 {
            let messages = if use_system {
                vec![
                    ChatMessage {
                        role: "system",
                        content: Cow::Borrowed(system),
                    },
                    ChatMessage {
                        role: "user",
                        content: Cow::Borrowed(user),
                    },
                ]
            } else {
                vec![ChatMessage {
                    role: "user",
                    content: Cow::Owned(format!("{system}\n\n{user}")),
                }]
            };

            let body = ChatRequest {
                model,
                messages,
                temperature: if send_temperature { Some(0.1) } else { None },
                max_tokens,
            };

            let response = client
                .post(endpoint.clone())
                .bearer_auth(api_key)
                .json(&body)
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => {
                    let parsed: ChatResponse = response
                        .json()
                        .await
                        .map_err(|_| anyhow!("LLM 返回了无法解析的响应"))?;
                    return Self::extract_content(parsed, allow_reasoning_fallback);
                }
                Ok(response)
                    if attempt == 0
                        && (response.status() == StatusCode::TOO_MANY_REQUESTS
                            || response.status().is_server_error()) =>
                {
                    log::warn!(
                        "LLM 请求返回 {}，1 秒后重试: {endpoint}",
                        response.status()
                    );
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                Ok(response) if attempt == 0 && response.status() == StatusCode::BAD_REQUEST => {
                    let body_text = response.text().await.unwrap_or_default();
                    let lower = body_text.to_lowercase();
                    // 检测是否因不支持 system message 或 temperature 参数导致 400
                    if lower.contains("system") || lower.contains("temperature") {
                        log::info!("检测到模型不支持 system 或 temperature 参数，降级重试: {body_text}");
                        use_system = false;
                        send_temperature = false;
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        continue;
                    }
                    let snippet: String = body_text.chars().take(300).collect();
                    return Err(anyhow!("LLM 请求失败（HTTP 400）：{snippet}"));
                }
                Ok(response) => {
                    // 提供商通常把真实原因放在响应体（余额不足/模型不存在/参数不支持等），
                    // 截断后透出，避免只看到状态码无法定位
                    let status = response.status();
                    let body = response.text().await.unwrap_or_default();
                    let snippet: String = body.chars().take(300).collect();
                    log::warn!("LLM 请求失败 HTTP {status}: {endpoint}; body={snippet}");
                    return Err(anyhow!("LLM 请求失败（HTTP {status}）：{snippet}"));
                }
                Err(err) => {
                    // 透出底层原因（DNS/TLS/超时/代理），只记录 URL 不记录密钥
                    log::warn!("LLM 请求发送失败: {endpoint}; err={err}");
                    if attempt == 0 {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    } else {
                        return Err(anyhow!("LLM 请求失败：{err}（Base URL: {base_url}）"));
                    }
                }
            }
        }
        Err(anyhow!("LLM 请求失败，请稍后重试"))
    }

    pub async fn test_connection(
        db: &Database,
        input: LlmConfigInput,
    ) -> Result<LlmConnectionTest> {
        let (_, base_url, model) = Self::validate_input(&input)?;
        let api_key = match input.api_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            Some(key) => key.to_string(),
            None => db.get_setting("llm_api_key")?.unwrap_or_default(),
        };
        let api_key = Self::require_api_key(&api_key)?;
        let content = Self::chat_completion(
            &base_url,
            &model,
            &api_key,
            "你正在执行连接测试。仅返回 PONG。",
            "连接测试",
            // 不设 token 上限（思考模型的正式输出需要足量预算）；
            // 仅验证链路连通，允许回退读 reasoning_content
            None,
            true,
        )
        .await?;
        if content.trim().is_empty() {
            return Err(anyhow!("LLM 连接测试未返回内容"));
        }
        let _ = db;
        Ok(LlmConnectionTest {
            model,
            message: "连接成功".to_string(),
        })
    }

    fn find_ascii_ignore_case(haystack: &str, needle: &str) -> Option<usize> {
        if needle.is_empty() {
            return Some(0);
        }
        haystack.char_indices().find_map(|(byte_idx, _)| {
            let sub = &haystack[byte_idx..];
            if sub.len() >= needle.len()
                && sub.as_bytes()[..needle.len()].eq_ignore_ascii_case(needle.as_bytes())
            {
                Some(byte_idx)
            } else {
                None
            }
        })
    }

    /// 清洗模型输出中的思考标签（如 <think>...</think> 或 <thought>...</thought>）
    pub fn strip_thinking_tags(raw: &str) -> String {
        let mut s = raw.to_string();
        for tag_name in ["think", "thought"] {
            loop {
                let open_prefix = format!("<{tag_name}");
                let close_tag = format!("</{tag_name}>");

                if let Some(start) = Self::find_ascii_ignore_case(&s, &open_prefix) {
                    if let Some(rel_gt) = s[start..].find('>') {
                        let content_start = start + rel_gt + 1;
                        if let Some(rel_close) = Self::find_ascii_ignore_case(&s[content_start..], &close_tag) {
                            let close_start = content_start + rel_close;
                            let after = close_start + close_tag.len();
                            let prefix = &s[..start];
                            let suffix = &s[after..];
                            s = format!("{prefix}{suffix}");
                            continue;
                        } else {
                            s = s[..start].to_string();
                            break;
                        }
                    } else {
                        s = s[..start].to_string();
                        break;
                    }
                } else {
                    break;
                }
            }
        }
        s
    }

    fn normalize_description(raw: &str) -> String {
        let stripped = Self::strip_thinking_tags(raw);
        stripped
            .trim()
            .trim_matches('`')
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// 清洗模型输出：去首尾空白/反引号、压成单行。长度不设硬校验——
    /// 字数在提示词里约束（约 30 字），模型生成多少算多少，仅拒绝空结果。
    fn validate_description(raw: &str) -> Result<String> {
        let text = Self::normalize_description(raw);
        if text.is_empty() {
            return Err(anyhow!("LLM 未返回有效的简介内容"));
        }
        Ok(text)
    }

    /// 从 Markdown 文档正文提取有意义的说明文本供 LLM 生成简介
    fn clean_markdown_for_source(raw: &str) -> String {
        let trimmed = raw.trim_start_matches('\u{feff}').trim();
        let body = if trimmed.starts_with("---") {
            let parts: Vec<&str> = trimmed.splitn(3, "---").collect();
            if parts.len() >= 3 {
                parts[2].trim()
            } else {
                trimmed
            }
        } else {
            trimmed
        };

        let mut lines = Vec::new();
        let mut in_code_block = false;
        let mut total_chars = 0;

        for line in body.lines() {
            let line = line.trim();
            if line.starts_with("```") {
                in_code_block = !in_code_block;
                continue;
            }
            if in_code_block || line.is_empty() || line.starts_with("![") {
                continue;
            }
            lines.push(line);
            total_chars += line.len();
            if total_chars >= 3000 {
                break;
            }
        }

        lines.join("\n")
    }

    fn preserve_or_mark_failed(db: &Database, record: &SkillRecord) -> Result<()> {
        if record.description_status == STATUS_READY && record.display_description.is_some() {
            return Ok(());
        }
        db.update_skill_display_description(&record.id, None, STATUS_FAILED)?;
        Ok(())
    }

    async fn process_record(
        db: &Database,
        record: &SkillRecord,
        base_url: &str,
        model: &str,
        api_key: &str,
        // "en" = 英文简介；其他 = 中文简介
        language: &str,
    ) -> Result<()> {
        let source = if let Some(desc) = record
            .description
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
        {
            desc.to_string()
        } else {
            let storage_dir = crate::services::skill_service::SkillService::skill_storage_dir(db, record).ok();
            let mut extracted = String::new();
            if let Some(dir) = storage_dir {
                let skill_md = dir.join("SKILL.md");
                let readme_md = dir.join("README.md");
                let candidate = if skill_md.exists() {
                    Some(skill_md)
                } else if readme_md.exists() {
                    Some(readme_md)
                } else {
                    None
                };
                if let Some(path) = candidate {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        extracted = Self::clean_markdown_for_source(&content);
                    }
                }
            }
            if extracted.is_empty() {
                if !record.display_name.is_empty() {
                    record.display_name.clone()
                } else {
                    record.name.clone()
                }
            } else {
                let _ = db.update_skill_raw_description(&record.id, &extracted);
                extracted
            }
        };

        let skill_name = if !record.display_name.is_empty() {
            &record.display_name
        } else {
            &record.name
        };
        let input_text = format!("技能名称: {}\n原始说明: {}", skill_name, source);
        let input_text: String = input_text.chars().take(8_000).collect();
        let prompt = if language == "en" {
            "You are a software skill marketplace editor. Based on the provided skill name and source text, write a single-line English skill summary of about 20 words. Focus strictly on what the skill does, the problems it solves, and its core value for users. Discard and do NOT mention any slash commands (such as /command), trigger phrases, parameter flags, activation/deactivation instructions, or operational steps. Output only the summary itself with no quotes, titles, Markdown, thinking process, or <think> tags."
        } else {
            "你是一个 AI 技能市场的产品编辑。请根据提供的技能名称与原始说明，提炼出一句 20 词左右的单行中文简介。重点概括该技能的核心功能定位、解决的问题及使用价值。严禁包含任何唤醒指令、斜杠命令（如 /xxx）、触发词、参数配置或'启动用/停止用'等操作步骤细节。输出只包含简介本身，不要引号、标题、Markdown、思考过程或 <think> 标签。"
        };
        let result = Self::chat_completion(
            base_url,
            model,
            api_key,
            prompt,
            &input_text,
            // 不设 token 上限：思考模型的推理会消耗大量预算，
            // 客户端设上限会掐断正式输出（step-3.7-flash 实测 512/2048 均只出思考）
            None,
            // 简介必须是正式 content；推理模型的思考链不能当简介
            false,
        )
        .await
        .and_then(|content| Self::validate_description(&content));
        match result {
            Ok(display_description) => {
                db.update_skill_display_description(
                    &record.id,
                    Some(&display_description),
                    STATUS_READY,
                )?;
                Ok(())
            }
            Err(error) => {
                Self::preserve_or_mark_failed(db, record)?;
                Err(error)
            }
        }
    }

    /// 批量生成中文简介。ids 为空表示全部技能；api_key 由调用方（前端）传入，
    /// 若为空则自动回退使用后端配置的 API Key。
    pub async fn process_skills(
        db: &Database,
        ids: &[String],
        api_key: &str,
        language: &str,
    ) -> Result<DescriptionProcessingResult> {
        let config = Self::get_config(db)?;
        if config.base_url.is_empty() || config.model.is_empty() {
            return Err(anyhow!("请先保存完整的模型配置（Base URL 与模型名称）"));
        }
        let api_key = if api_key.trim().is_empty() {
            db.get_setting("llm_api_key")?
                .unwrap_or_default()
        } else {
            api_key.to_string()
        };
        let api_key = Self::require_api_key(&api_key)?;
        let base_url = Self::normalize_base_url(&config.base_url)?;
        let records: Vec<SkillRecord> = if ids.is_empty() {
            db.get_all_skills()?.into_values().collect()
        } else {
            let mut records = Vec::with_capacity(ids.len());
            for id in ids {
                if let Some(record) = db.get_skill(id)? {
                    records.push(record);
                }
            }
            records
        };
        let mut result = DescriptionProcessingResult {
            processed: records.len(),
            succeeded: 0,
            failures: Vec::new(),
        };
        let effective_language = if language.trim().is_empty() {
            if config.language.is_empty() {
                "zh"
            } else {
                &config.language
            }
        } else {
            language
        };
        for record in &records {
            match Self::process_record(
                db,
                record,
                &base_url,
                &config.model,
                &api_key,
                effective_language,
            )
            .await
            {
                Ok(()) => result.succeeded += 1,
                Err(error) => result.failures.push(DescriptionProcessingFailure {
                    skill_id: record.id.clone(),
                    reason: error.to_string(),
                }),
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::{ChatChoice, ChatMessageResponse, ChatResponse, LlmService};

    #[test]
    fn strip_thinking_tags_handles_think_and_thought_tags() {
        let text1 = "<think>这里是模型的长篇思考过程</think>这是一个好用的代码助手。";
        assert_eq!(
            LlmService::strip_thinking_tags(text1),
            "这是一个好用的代码助手。"
        );

        let text2 = "<THINK>大写标签思考过程\n第二行思考</THINK>前端设计组件库";
        assert_eq!(
            LlmService::strip_thinking_tags(text2),
            "前端设计组件库"
        );

        let text3 = "<thought>思考中...</thought>提供多语言文本总结功能。";
        assert_eq!(
            LlmService::strip_thinking_tags(text3),
            "提供多语言文本总结功能。"
        );

        let unclosed = "<think>未闭合的思考内容导致正文缺失";
        assert_eq!(LlmService::strip_thinking_tags(unclosed), "");

        let no_tags = "正常无标签输出简介";
        assert_eq!(LlmService::strip_thinking_tags(no_tags), no_tags);
    }

    #[test]
    fn validates_description_normalizes_and_rejects_empty() {
        // 归一化：过滤思考标签、去反引号、压单行、去空行
        assert_eq!(
            LlmService::validate_description("<think>思考过程</think>`用于管理技能的简介`").unwrap(),
            "用于管理技能的简介"
        );
        assert_eq!(
            LlmService::validate_description("第一行\n\n第二行").unwrap(),
            "第一行 第二行"
        );
        // 长度不设硬校验：短/长结果都接受（字数仅由提示词约束）
        assert!(LlmService::validate_description("很短的简介").is_ok());
        assert!(LlmService::validate_description(&"技".repeat(80)).is_ok());
        // 仅拒绝空结果
        assert!(LlmService::validate_description("   \n  ").is_err());
        assert!(LlmService::validate_description("``").is_err());
        assert!(LlmService::validate_description("<think>只有思考无正文</think>").is_err());
    }

    #[test]
    fn normalizes_base_url_and_rejects_full_endpoint() {
        assert_eq!(
            LlmService::normalize_base_url("https://example.com/v1/").unwrap(),
            "https://example.com/v1"
        );
        assert!(LlmService::normalize_base_url("ftp://example.com").is_err());
        assert!(LlmService::normalize_base_url("https://example.com/v1/chat/completions").is_err());
    }

    fn resp(content: Option<&str>, reasoning: Option<&str>, finish: Option<&str>) -> ChatResponse {
        ChatResponse {
            choices: vec![ChatChoice {
                message: ChatMessageResponse {
                    content: content.map(str::to_string),
                    reasoning_content: reasoning.map(str::to_string),
                },
                finish_reason: finish.map(str::to_string),
            }],
        }
    }

    #[test]
    fn extract_content_prefers_content_and_rejects_empty() {
        let ok = LlmService::extract_content(resp(Some("PONG"), None, Some("stop")), false).unwrap();
        assert_eq!(ok, "PONG");
        // 两者皆空：报错带 finish_reason
        let err = LlmService::extract_content(resp(None, None, Some("length")), false).unwrap_err();
        assert!(err.to_string().contains("finish_reason=length"), "{err}");
        // choices 为空
        let empty = ChatResponse { choices: vec![] };
        assert!(LlmService::extract_content(empty, false).is_err());
    }

    #[test]
    fn extract_content_reasoning_fallback_only_when_allowed() {
        let reasoning = resp(Some("  "), Some("思考链"), Some("length"));
        // 允许回退（连接测试）：思考链可证明链路连通
        assert_eq!(
            LlmService::extract_content(reasoning, true).unwrap(),
            "思考链"
        );
        // 不允许（描述生成）：思考链不能当简介
        let reasoning = resp(Some(""), Some("思考链"), Some("length"));
        assert!(LlmService::extract_content(reasoning, false).is_err());
    }
}
