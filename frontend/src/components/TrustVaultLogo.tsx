import { useId, type HTMLAttributes } from "react";
import "./TrustVaultLogo.css";

type TrustVaultLogoProps = HTMLAttributes<HTMLSpanElement> & {
  compact?: boolean;
  animated?: boolean;
  label?: string;
};

/** A compact, accessible SVG identity for navigation, loading, and favicon-adjacent use. */
export function TrustVaultLogo({
  compact = false,
  animated = true,
  label = "TrustVault",
  className = "",
  ...props
}: TrustVaultLogoProps) {
  const instanceId = useId().replaceAll(":", "");
  const mochaId = `tv-mocha-${instanceId}`;
  const silverId = `tv-silver-${instanceId}`;
  const glowId = `tv-glow-${instanceId}`;
  const clipId = `tv-shield-clip-${instanceId}`;

  return (
    <span
      className={`tv-logo ${compact ? "tv-logo--compact" : ""} ${animated ? "tv-logo--animated" : ""} ${className}`.trim()}
      aria-label={label}
      {...props}
    >
      <svg className="tv-logo__mark" viewBox="0 0 64 64" role="img" aria-hidden="true">
        <defs>
          <linearGradient id={mochaId} x1="12" y1="8" x2="52" y2="58" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8b654a" />
            <stop offset="1" stopColor="#4b3327" />
          </linearGradient>
          <linearGradient id={silverId} x1="18" y1="14" x2="47" y2="51" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" />
            <stop offset=".46" stopColor="#dedde0" />
            <stop offset="1" stopColor="#aeadb3" />
          </linearGradient>
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id={clipId}><path d="M32 5.8 53 14.2v15.2c0 13.8-8.4 24.6-21 29.4C19.4 54 11 43.2 11 29.4V14.2L32 5.8Z" /></clipPath>
        </defs>
        <path className="tv-logo__halo" d="M32 4.2 54.5 13v16.3c0 14.7-9 26.2-22.5 31.3C18.5 55.5 9.5 44 9.5 29.3V13L32 4.2Z" />
        <path className="tv-logo__shield" fill={`url(#${mochaId})`} d="M32 5.8 53 14.2v15.2c0 13.8-8.4 24.6-21 29.4C19.4 54 11 43.2 11 29.4V14.2L32 5.8Z" />
        <g clipPath={`url(#${clipId})`}>
          <path className="tv-logo__shimmer" d="M3 13 18 5l38 39-12 14L3 20Z" />
        </g>
        <path className="tv-logo__document" d="M23 18.2h12.7l5.4 5.3v19.3a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3V21.2a3 3 0 0 1 3-3Z" />
        <path className="tv-logo__fold" d="M35.7 18.2v5.3h5.4" />
        <path className="tv-logo__line" d="M25.3 29.6h10.3M25.3 34.1h7.2" />
        <path className="tv-logo__lock" d="M27.3 40.1v-2a4.7 4.7 0 0 1 9.4 0v2" />
        <rect className="tv-logo__lock-body" x="25.3" y="40" width="13.4" height="10" rx="2.4" />
        <path className="tv-logo__check" d="m28.8 45 2.2 2.2 4.3-4.6" />
        <circle className="tv-logo__accent" cx="47.5" cy="17.3" r="3.2" filter={`url(#${glowId})`} />
      </svg>
      {!compact && <span className="tv-logo__wordmark">Trust<span>Vault</span></span>}
    </span>
  );
}
