import { motion } from "motion/react";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark";
  animated?: boolean;
}

const sizeMap = {
  sm: { icon: 32, text: "text-lg" },
  md: { icon: 40, text: "text-xl" },
  lg: { icon: 48, text: "text-2xl" },
};

export default function BrandLogo({ size = "md", variant = "dark", animated = false }: BrandLogoProps) {
  const { icon, text } = sizeMap[size];
  const textColor = variant === "light" ? "text-white" : "text-gray-900";

  const iconEl = (
    <svg width={icon} height={icon} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#008040" />
          <stop offset="100%" stopColor="#00A651" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#brand-grad)" />
      <path d="M10 13h20M10 20h13M10 27h20" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );

  const wrapper = animated ? (
    <motion.div
      className="flex items-center gap-2.5 select-none"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {iconEl}
      <span className={`font-bold tracking-tight ${text} ${textColor}`}>Easy Moderator</span>
    </motion.div>
  ) : (
    <div className="flex items-center gap-2.5 select-none">
      {iconEl}
      <span className={`font-bold tracking-tight ${text} ${textColor}`}>Easy Moderator</span>
    </div>
  );

  return wrapper;
}
