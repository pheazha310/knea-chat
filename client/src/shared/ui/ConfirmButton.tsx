import React, { useEffect, useRef, useState } from 'react';

interface ConfirmButtonProps {
  label: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
  confirmLabel?: string;
}

/**
 * Two-step destructive-action button: first click arms it ("Confirm?"),
 * a second click within 3s performs the action. Clicking anywhere else or
 * waiting resets it — no window.confirm() dialogs.
 */
const ConfirmButton = ({
  label,
  onConfirm,
  className = 'btn-danger',
  disabled = false,
  confirmLabel = 'Confirm?',
}: ConfirmButtonProps) => {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!armed) return;
    const disarm = () => setArmed(false);
    document.addEventListener('click', disarm);
    return () => document.removeEventListener('click', disarm);
  }, [armed]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || busyRef.current) return;
    if (!armed) {
      setArmed(true);
      timerRef.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setArmed(false);
    // Guard against double-firing from a fast second click before re-render.
    busyRef.current = true;
    Promise.resolve()
      .then(() => onConfirm())
      .finally(() => {
        busyRef.current = false;
      });
  };

  return (
    <button
      type="button"
      className={`${className} ${armed ? 'armed' : ''}`}
      disabled={disabled}
      onClick={handleClick}
      title={armed ? 'Click again to confirm' : label}
    >
      {armed ? confirmLabel : label}
    </button>
  );
};

export default ConfirmButton;
