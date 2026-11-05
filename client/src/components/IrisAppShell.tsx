import { ReactNode } from "react";

type IrisAppShellProps = {
  children: ReactNode;
};

/**
 * Shell pass-through garantindo a renderização direta e única do Command Center 5.4,
 * eliminando resíduos de layouts anteriores (5.3) ou telas intermediárias duplicadas.
 */
export default function IrisAppShell({ children }: IrisAppShellProps) {
  return <>{children}</>;
}
