import { useId } from "react";

/**
 * Logo da marca "Controle Financeiro".
 *
 * O símbolo é um badge com gradiente roxo (cor primária da marca) contendo
 * uma curva de crescimento ascendente — remete a finanças/evolução e, ao
 * mesmo tempo, o recorte à esquerda evoca a inicial "C".
 */
export function Logo({
  size = 30,
  radius,
  className = "",
  title = "Controle Financeiro",
}: {
  size?: number;
  radius?: number;
  className?: string;
  title?: string;
}) {
  const id = useId();
  const gId = `cf-grad-${id}`;
  const r = radius ?? Math.round(size * 0.3);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gId} x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="0.55" stopColor="#6D28D9" />
          <stop offset="1" stopColor="#5B21B6" />
        </linearGradient>
      </defs>

      {/* Badge */}
      <rect x="0" y="0" width="48" height="48" rx={(r / size) * 48} fill={`url(#${gId})`} />

      {/* Brilho interno sutil no topo */}
      <rect
        x="0"
        y="0"
        width="48"
        height="24"
        rx={(r / size) * 48}
        fill="#ffffff"
        opacity="0.10"
      />

      {/* Curva de crescimento (também evoca o "C") */}
      <path
        d="M11 31.5 L20 24.5 L27.5 28.5 L37 16.5"
        stroke="#ffffff"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Seta */}
      <path
        d="M30.5 16.5 H37 V23"
        stroke="#ffffff"
        strokeWidth="3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Ponto de partida (moeda) */}
      <circle cx="11" cy="31.5" r="2.6" fill="#ffffff" />
    </svg>
  );
}
