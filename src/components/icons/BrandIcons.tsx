import React from 'react';
import { HERMES_SVG_PATH } from './hermesPath';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
}

/**
 * Official Anthropic Claude Brand Icon
 * Exact 14-lobed asterisk symbol geometry from Anthropic brand assets
 */
export const ClaudeIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      width={size}
      height={size}
      aria-label="Anthropic Claude"
      {...props}
    >
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
};

/**
 * Official Claude Code CLI Terminal Mascot Icon
 * The pixel character official glyph of Anthropic's Claude Code CLI
 */
export const ClaudeCodeIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      width={size}
      height={size}
      aria-label="Claude Code"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
      />
    </svg>
  );
};

/**
 * Official OpenAI Codex Icon
 * OpenAI 官方标识矢量图，使用 currentColor 呈现
 */
export const CodexIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      width={size}
      height={size}
      aria-label="OpenAI Codex"
      {...props}
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
};

/**
 * Official Google Gemini Brand Icon
 * The authentic four-pointed curved celestial star with Google multi-stop rainbow gradient
 */
export const GeminiIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  const rawId = React.useId();
  const gradId = 'gemini-grad-' + rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      width={size}
      height={size}
      aria-label="Google Gemini"
      {...props}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3186FF" />
          <stop offset="35%" stopColor="#9B66FF" />
          <stop offset="70%" stopColor="#F94543" />
          <stop offset="100%" stopColor="#FABC12" />
        </linearGradient>
      </defs>
      <path
        d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
        fill={`url(#${gradId})`}
      />
    </svg>
  );
};

/**
 * Official OpenCode Brand Icon
 * Anomaly / SST OpenCode official nested geometric frame
 */
export const OpenCodeIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      width={size}
      height={size}
      aria-label="OpenCode"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 6H8v12h8V6zm4 16H4V2h16v20z"
      />
    </svg>
  );
};

/**
 * Official OpenClaw Brand Icon
 * Pure SVG vector matching official lobster mascot (round body, cyan eyes, dual raised pincers)
 */
export const OpenClawIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      aria-label="OpenClaw"
      {...props}
    >
      {/* 头部触角 */}
      <path
        d="M44 32 C38 22 30 18 24 18"
        stroke="#DC2626"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M56 32 C62 22 70 18 76 18"
        stroke="#DC2626"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {/* 左右延伸臂 */}
      <path
        d="M26 56 C18 54 13 49 13 43"
        stroke="#B91C1C"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M74 56 C82 54 87 49 87 43"
        stroke="#B91C1C"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      {/* 左向上大钳 */}
      <path
        d="M12 44 C3 38 3 28 12 28 C15 32 15 38 12 44 Z"
        fill="#EF4444"
      />
      <path
        d="M13 44 C19 46 22 36 17 31 C13 35 12 40 13 44 Z"
        fill="#DC2626"
      />
      {/* 右向上大钳 */}
      <path
        d="M88 44 C97 38 97 28 88 28 C85 32 85 38 88 44 Z"
        fill="#EF4444"
      />
      <path
        d="M87 44 C81 46 78 36 83 31 C87 35 88 40 87 44 Z"
        fill="#DC2626"
      />
      {/* 大红圆形躯干 */}
      <circle cx="50" cy="55" r="28" fill="#DC2626" />
      {/* 青色圆溜溜发光双眼 */}
      <circle cx="41" cy="43" r="4.2" fill="#06B6D4" />
      <circle cx="42.2" cy="41.8" r="1.4" fill="#FFFFFF" />
      <circle cx="59" cy="43" r="4.2" fill="#06B6D4" />
      <circle cx="60.2" cy="41.8" r="1.4" fill="#FFFFFF" />
    </svg>
  );
};

/**
 * Official Hermes Agent (Nous Research) Brand Icon
 * Pure SVG vector parsed from official Nous Research anime girl with headphones and N collar insignia
 */
export const HermesIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="currentColor"
      className={className}
      width={size}
      height={size}
      aria-label="Hermes Agent (Nous Research)"
      {...props}
    >
      <path d={HERMES_SVG_PATH} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
};

/**
 * Official Google Antigravity Brand Icon
 * 官方矢量字形，Google 官方科技蓝到紫罗兰渐变 (#4285F4 -> #9B72CB)
 */
export const AntigravityIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  const rawId = React.useId();
  const gradId = 'ag-grad-' + rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      aria-label="Google Antigravity"
      {...props}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#9B72CB" />
        </linearGradient>
      </defs>
      <path
        d="M21.751 22.552c1.34 1.005 3.35.335 1.508-1.507-5.528-5.36-4.355-20.1-11.222-20.1S6.342 15.686.815 21.046c-2.01 2.01.167 2.512 1.507 1.507 5.192-3.517 4.857-9.715 9.715-9.715s4.522 6.198 9.714 9.715"
        fill={`url(#${gradId})`}
      />
    </svg>
  );
};

/**
 * 专属自定义 AI 工具适配器图标
 * 采用模块化多边形插拔槽位、扩展触点与智联引脚设计
 */
export const CustomToolIcon: React.FC<IconProps> = ({ className = 'w-5 h-5', size = 20, ...props }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      aria-label="自定义工具"
      {...props}
    >
      {/* 外层模块化六边形基座 */}
      <path
        d="M12 2.5L20.2 7.2V16.8L12 21.5L3.8 16.8V7.2L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 内部中心可插拔微芯片核心 */}
      <rect
        x="9"
        y="9"
        width="6"
        height="6"
        rx="1.5"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* 上下总线扩展极点 */}
      <path d="M12 2.5V6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M12 17.5V21.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      {/* 左右智联引脚 */}
      <path d="M3.8 12H6.8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M17.2 12H20.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      {/* 核心微光指示点 */}
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
};

/**
 * Official Tool Brand Icon helper with curated background, border and drop shadow
 */
export const ToolBrandIcon: React.FC<{ toolId: string; size?: number; className?: string }> = ({
  toolId,
  size = 18,
  className = '',
}) => {
  switch (toolId) {
    case 'claude-code':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-[#FAF5F2] text-[#D97757] border border-[#F3E2D8] p-1 shadow-2xs ${className}`}
          title="Anthropic Claude Code"
        >
          <ClaudeIcon size={size} />
        </span>
      );
    case 'codex':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-black text-white border border-slate-800 p-1 shadow-2xs ${className}`}
          title="OpenAI Codex"
        >
          <CodexIcon size={size} />
        </span>
      );
    case 'antigravity-cli':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-[#F4F7FF] border border-[#DDE7FF] p-1 shadow-2xs ${className}`}
          title="Google Antigravity CLI"
        >
          <AntigravityIcon size={size} />
        </span>
      );
    case 'gemini-cli':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-[#F0F4FF] border border-[#DDE7FF] p-1 shadow-2xs ${className}`}
          title="Google Gemini CLI"
        >
          <GeminiIcon size={size} />
        </span>
      );
    case 'opencode':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-white text-[#0F172A] border border-slate-200 p-1 shadow-2xs ${className}`}
          title="OpenCode AI Agent"
        >
          <OpenCodeIcon size={size} />
        </span>
      );
    case 'openclaw':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-[#FFF1F2] border border-[#FECDD3] p-1 shadow-2xs ${className}`}
          title="OpenClaw"
        >
          <OpenClawIcon size={size} />
        </span>
      );
    case 'hermes':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-white text-[#09090B] border border-[#E2E8F0] p-1 shadow-2xs overflow-hidden ${className}`}
          title="Hermes Agent (Nous Research)"
        >
          <HermesIcon size={size} />
        </span>
      );
    case 'custom':
    case 'custom-tool':
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE] p-1 shadow-2xs ${className}`}
          title="自定义 AI 工具"
        >
          <CustomToolIcon size={size} />
        </span>
      );
    default:
      return (
        <span
          className={`inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-700 border border-slate-200 p-1 shadow-2xs ${className}`}
          title="自定义 AI 工具适配器"
        >
          <CustomToolIcon size={size} />
        </span>
      );
  }
};

/** SkillDock 官方品牌图标，与桌面应用及安装包共用同一母图。 */
export const SkillDockLogo: React.FC<{ size?: number; className?: string }> = ({
  size = 32,
  className = '',
}) => {
  return (
    <img
      src="/app-icon.png"
      alt=""
      aria-hidden="true"
      className={`block object-contain shrink-0 transition-transform duration-200 group-hover:scale-105 ${className}`}
      style={{ width: size, height: size }}
    />
  );
};
