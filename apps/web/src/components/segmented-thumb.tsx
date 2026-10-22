'use client';

import { motion } from 'motion/react';

export function SegmentedThumb({ layoutId }: { layoutId: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      className="absolute inset-0 rounded-ui-sm bg-surface shadow-card"
      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
    />
  );
}
