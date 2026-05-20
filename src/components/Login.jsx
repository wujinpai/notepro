import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function Login() {
  const { state, login, dispatch } = useApp();
  const [show, setShow] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (state.isLoggedIn) return null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    login(password).then((ok) => {
      setLoading(false);
      if (ok) {
        setShow(false);
        setPassword('');
      }
    });
  }

  return (
    <>
      <button className="login-trigger" onClick={() => setShow(true)} style={{ display: 'none' }} />
      {show && (
        <div className="login-overlay" onClick={() => setShow(false)}>
          <div className="login-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="login-title">登录</h3>
            <form onSubmit={handleSubmit}>
              <input
                className="login-input"
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                disabled={loading}
              />
              <button className="login-submit" type="submit" disabled={loading}>
                {loading ? '登录中...' : '登录'}
              </button>
            </form>
            <button className="login-close" onClick={() => setShow(false)}>
              <i className="icon-close" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
