import { useApp } from '../context/AppContext';

const ICONS = {
  success: 'icon-check-circle',
  error: 'icon-close-circle',
  warning: 'icon-alert',
  info: 'icon-info-circle',
};

export default function Toast() {
  const { state, dispatch } = useApp();
  const { toasts } = state;

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <i className={ICONS[toast.type] || ICONS.info} />
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" onClick={() => dispatch({ type: 'REMOVE_TOAST', payload: toast.id })}>
            <i className="icon-close" />
          </button>
        </div>
      ))}
    </div>
  );
}
