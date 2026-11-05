import React from "react";

interface IrisOcularEyeProps {
  className?: string;
  onClick?: () => void;
}

/**
 * Componente visual oficial da Íris Ocular da Iris IA.
 * Enquadra a imagem real /image.png em uma área perfeitamente circular,
 * garantindo recorte de cantos retangulares e preenchimento total.
 */
export default function IrisOcularEye({ className = "", onClick }: IrisOcularEyeProps) {
  return (
    <div
      className={`iris54-ocular-eye-wrapper ${className}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      role="button"
      tabIndex={0}
      title="Iris IA — Íris Ocular Tecnológica"
      aria-label="Íris Ocular da Iris IA"
    >
      <div className="iris54-ocular-eye-frame">
        <img
          src="/image.png"
          alt="Íris Ocular Tecnológica Azul da Iris IA"
          className="iris54-ocular-eye-img"
          draggable={false}
        />
        <div className="iris54-ocular-eye-overlay" />
      </div>
    </div>
  );
}
