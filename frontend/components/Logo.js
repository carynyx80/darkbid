// Darkbid mark: a hollow "dark" D beside a solid "bid" B.
export default function Logo({ width = 50, className }) {
  return (
    <svg
      className={className}
      width={width}
      height={(width * 160) / 250}
      viewBox="0 0 250 160"
      role="img"
      aria-label="Darkbid"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(26 0) skewX(-10)">
        <path
          d="M20 20 H80 L110 50 V110 L80 140 H20 Z M48 48 V112 H70 L82 100 V60 L70 48 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          fillRule="evenodd"
          fill="currentColor"
          d="M126 20 H190 L212 42 V66 L198 80 L212 94 V118 L190 140 H126 Z M154 46 V68 H180 L186 62 V52 L180 46 Z M154 92 V114 H180 L186 108 V98 L180 92 Z"
        />
      </g>
    </svg>
  );
}
