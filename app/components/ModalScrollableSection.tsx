import type { ReactNode } from "react";

export function ModalScrollableSection({
  children,
  maxHeight = "calc(80vh - 140px)",
}: {
  children: ReactNode;
  maxHeight?: number | string;
}) {
  return (
    <div style={{ maxHeight, overflowY: "auto", paddingRight: 4 }}>
      {children}
    </div>
  );
}

