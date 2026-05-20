import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function Header() {
  const { state, dispatch } = useApp();
  const { personal } = state.settings;
  const [showLogin, setShowLogin] = useState(false);

  const bgStyle = personal.background
    ? { backgroundImage: `url(${personal.background})` }
    : { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' };

  return (
    <header className="header">
      <div className="header-bg" style={bgStyle}>
        <div className="header-overlay" />
      </div>
      <div className="header-content">
        <div className="header-avatar-wrap">
          <img
            className="header-avatar"
            src={personal.avatar || '/assets/img/default-avatar.png'}
            alt={personal.nickname}
            onError={(e) => { e.target.src = '/assets/img/default-avatar.png'; }}
          />
        </div>
        <h1 className="header-nickname">{personal.nickname}</h1>
        <p className="header-signature">{personal.signature}</p>
        {personal.email && (
          <a className="header-email" href={`mailto:${personal.email}`}>
            <i className="icon-mail" /> {personal.email}
          </a>
        )}
        <div className="header-social">
          {personal.social?.github && (
            <a href={personal.social.github} target="_blank" rel="noopener noreferrer" title="GitHub">
              <i className="icon-github" />
            </a>
          )}
          {personal.social?.twitter && (
            <a href={personal.social.twitter} target="_blank" rel="noopener noreferrer" title="Twitter">
              <i className="icon-twitter" />
            </a>
          )}
          {personal.social?.weibo && (
            <a href={personal.social.weibo} target="_blank" rel="noopener noreferrer" title="Weibo">
              <i className="icon-weibo" />
            </a>
          )}
          {personal.social?.zhihu && (
            <a href={personal.social.zhihu} target="_blank" rel="noopener noreferrer" title="Zhihu">
              <i className="icon-zhihu" />
            </a>
          )}
          {!state.isLoggedIn && (
            <button className="header-login-btn" onClick={() => setShowLogin(true)} title="登录">
              <i className="icon-lock" />
            </button>
          )}
          {state.isLoggedIn && (
            <button className="header-logout-btn" onClick={() => dispatch({ type: 'SHOW_SETTINGS', payload: true })} title="设置">
              <i className="icon-cog" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
