import { PropsWithChildren } from "react";
import { colors, spacing } from "../tokens";

export function Surface({ children }: PropsWithChildren) {
  return (
    <div
      style={{
        backgroundColor: colors.background,
        border: `1px solid ${colors.primary}66`,
        borderRadius: 16,
        padding: spacing.lg
      }}
    >
      {children}
    </div>
  );
}
