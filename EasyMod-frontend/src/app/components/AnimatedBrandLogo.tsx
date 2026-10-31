import { motion } from "motion/react";
import type { ReactNode } from "react";

export default function AnimatedBrandLogo({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="flex items-center gap-2.5 select-none"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
