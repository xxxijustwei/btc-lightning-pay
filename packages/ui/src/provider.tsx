import { ConfigProvider } from "@lobehub/ui";
import { MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";

export function UIProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <ConfigProvider motion={motion} enableCustomFonts={false}>
        {children}
      </ConfigProvider>
    </MotionConfig>
  );
}
