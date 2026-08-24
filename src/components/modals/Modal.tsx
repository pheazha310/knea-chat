import React from 'react';
import Icon from '../common/Icon';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}

const Modal = ({ title, onClose, children, width = 470 }: ModalProps) => (
  <div className="modal-overlay anim-overlay-in" onClick={onClose}>
    <div
      className="modal anim-modal-in"
      style={{ width }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="modal-header">
        <h3>{title}</h3>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </div>
  </div>
);

export default Modal;
