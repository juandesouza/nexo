import { NEXO_LOGO_TITLE, NEXO_LOGO_VIEWBOX, type NexoLogoProps } from "./NexoLogo.shared";

export function NexoLogo({ className, width = 148, height = 40 }: NexoLogoProps) {
  return (
    <svg
      role="img"
      aria-label={NEXO_LOGO_TITLE}
      className={className}
      width={width}
      height={height}
      viewBox={NEXO_LOGO_VIEWBOX}
      preserveAspectRatio="xMinYMid meet"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="nexoWordmarkGradient" x1="0" y1="0" x2="320" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2D7BFF" />
          <stop offset="100%" stopColor="#39FF88" />
        </linearGradient>
      </defs>
      <text
        x="0"
        y="66"
        fill="url(#nexoWordmarkGradient)"
        fontFamily="'Nunito', 'Quicksand', 'Poppins', 'Arial Rounded MT Bold', sans-serif"
        fontSize="64"
        fontWeight="800"
        letterSpacing="1.2"
      >
        NEXO
      </text>
    </svg>
  );
}
