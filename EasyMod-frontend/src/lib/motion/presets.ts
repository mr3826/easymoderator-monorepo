/**
 * Shared Framer Motion variants and transition constants.
 * Import from "@/lib/motion" — never write inline transition props that duplicate these.
 */
import type { Variants } from "framer-motion";

// ─── Shared transition constants ──────────────────────────────────────────────

export const transitions = {
  ease: "easeOut" as const,
  duration: 0.3,
  spring: { type: "spring" as const, stiffness: 300, damping: 20 },
};

// ─── Variants ─────────────────────────────────────────────────────────────────

/** Fade up: opacity 0→1, y 12→0. Use on list items, cards, page sections. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: transitions.duration, ease: transitions.ease },
  },
};

/**
 * Stagger container — apply to the parent wrapping elements that use fadeUp.
 * Children animate in sequence with 60ms delay between each.
 */
export const staggerChildren: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
};

/**
 * Card hover lift — use as `whileHover` on interactive cards/buttons.
 * Uses spring so it feels physical on cancel.
 */
export const cardHover = {
  scale: 1.02,
  transition: transitions.spring,
};

/**
 * Success pulse — scale 1→1.05→1 after a successful action (e.g. message sent).
 * Apply as `animate` on the element that should pulse.
 */
export const successPulse: Variants = {
  idle: { scale: 1 },
  pulse: {
    scale: [1, 1.05, 1],
    transition: { duration: 0.4, ease: "easeInOut" },
  },
};

/**
 * Error shake — quick horizontal oscillation on validation failure.
 * Apply as `animate` on the element that should shake.
 */
export const errorShake: Variants = {
  idle: { x: 0 },
  shake: {
    x: [0, -8, 8, -6, 6, -3, 3, 0],
    transition: { duration: 0.5, ease: "easeInOut" },
  },
};
