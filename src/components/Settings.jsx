import { useState } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../utils/api';

const TABS = [
  { key: 'personal', label: '个人', icon: 'icon-user' },
  { key: 'website', label: '网站', icon: 'icon-globe' },
  { key: 'content', label: '内容', icon: 'icon-note' },
  { key: 'system', label: '系统', icon: 'icon-cog' },
  { key: 'colors', label: '颜色', icon: 'icon-palette' },
];

export default function Settings() {
  const { state, dispatch, toast, loadSettings, logout } = useApp();
  const [activeTab, setActiveTab] = useState('personal');
  const [form, setForm] = useState({ ...state.settings });
  const [saving, setSaving] = useState(false);

  function updateForm(section, key, value) {
    setForm((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  }

  function updateNestedForm(section, subKey, key, value) {
    setForm((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [subKey]: { ...prev[section][subKey], [key]: value },
      },
    }));
  }

  function handleClose() {
    dispatch({ type: 'SHOW_SETTINGS', payload: false });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.settings.update(form);
      toast('设置已保存', 'success');
      loadSettings();
    } catch {
      toast('保存设置失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await logout();
    handleClose();
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await api.media.upload(file);
      updateForm('personal', 'avatar', result.url || result.path);
      toast('头像上传成功', 'success');
    } catch {
      toast('头像上传失败', 'error');
    }
  }

  async function handleBgUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await api.media.upload(file);
      updateForm('personal', 'background', result.url || result.path);
      toast('背景上传成功', 'success');
    } catch {
      toast('背景上传失败', 'error');
    }
  }

  async function handleChangePassword() {
    const oldPwd = prompt('请输入旧密码');
    const newPwd = prompt('请输入新密码');
    if (!oldPwd || !newPwd) return;
    try {
      await api.auth.changePassword(oldPwd, newPwd);
      toast('密码已修改', 'success');
    } catch {
      toast('密码修改失败', 'error');
    }
  }

  function renderPersonal() {
    const p = form.personal || {};
    return (
      <div className="settings-section">
        <div className="settings-field">
          <label>头像</label>
          <div className="settings-avatar-upload">
            {p.avatar && <img src={p.avatar} alt="" className="settings-avatar-preview" />}
            <input type="file" accept="image/*" onChange={handleAvatarUpload} />
          </div>
        </div>
        <div className="settings-field">
          <label>背景图</label>
          <div className="settings-avatar-upload">
            {p.background && <img src={p.background} alt="" className="settings-bg-preview" />}
            <input type="file" accept="image/*" onChange={handleBgUpload} />
          </div>
        </div>
        <div className="settings-field">
          <label>昵称</label>
          <input className="settings-input" value={p.nickname || ''} onChange={(e) => updateForm('personal', 'nickname', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>签名</label>
          <input className="settings-input" value={p.signature || ''} onChange={(e) => updateForm('personal', 'signature', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>邮箱</label>
          <input className="settings-input" type="email" value={p.email || ''} onChange={(e) => updateForm('personal', 'email', e.target.value)} />
        </div>
        <div className="settings-field-group">
          <h4>社交链接</h4>
          <div className="settings-field">
            <label><i className="icon-github" /> GitHub</label>
            <input className="settings-input" value={p.social?.github || ''} onChange={(e) => updateNestedForm('personal', 'social', 'github', e.target.value)} />
          </div>
          <div className="settings-field">
            <label><i className="icon-twitter" /> Twitter</label>
            <input className="settings-input" value={p.social?.twitter || ''} onChange={(e) => updateNestedForm('personal', 'social', 'twitter', e.target.value)} />
          </div>
          <div className="settings-field">
            <label><i className="icon-weibo" /> 微博</label>
            <input className="settings-input" value={p.social?.weibo || ''} onChange={(e) => updateNestedForm('personal', 'social', 'weibo', e.target.value)} />
          </div>
          <div className="settings-field">
            <label><i className="icon-zhihu" /> 知乎</label>
            <input className="settings-input" value={p.social?.zhihu || ''} onChange={(e) => updateNestedForm('personal', 'social', 'zhihu', e.target.value)} />
          </div>
        </div>
      </div>
    );
  }

  function renderWebsite() {
    const w = form.website || {};
    return (
      <div className="settings-section">
        <div className="settings-field">
          <label>站点名称</label>
          <input className="settings-input" value={w.name || ''} onChange={(e) => updateForm('website', 'name', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>站点描述</label>
          <textarea className="settings-textarea" value={w.description || ''} onChange={(e) => updateForm('website', 'description', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>关键词</label>
          <input className="settings-input" value={w.keywords || ''} onChange={(e) => updateForm('website', 'keywords', e.target.value)} />
        </div>
        <div className="settings-field">
          <label>每页文章数</label>
          <input className="settings-input" type="number" min="1" max="50" value={w.postsPerPage || 10} onChange={(e) => updateForm('website', 'postsPerPage', Number(e.target.value))} />
        </div>
        <div className="settings-field">
          <label>查看范围</label>
          <select className="settings-select" value={w.viewRange || 'all'} onChange={(e) => updateForm('website', 'viewRange', e.target.value)}>
            <option value="all">全部</option>
            <option value="public">仅公开</option>
            <option value="private">仅隐藏</option>
          </select>
        </div>
      </div>
    );
  }

  function renderContent() {
    const c = form.content || {};
    return (
      <div className="settings-section">
        <div className="settings-field">
          <label>标签列表</label>
          <div className="settings-tags-list">
            {(c.tags || []).map((tag, i) => (
              <span key={i} className="settings-tag-item">
                {typeof tag === 'string' ? tag : tag.name}
                <button onClick={() => {
                  const newTags = [...c.tags];
                  newTags.splice(i, 1);
                  updateForm('content', 'tags', newTags);
                }}><i className="icon-close" /></button>
              </span>
            ))}
          </div>
          <input
            className="settings-input"
            placeholder="添加标签，回车确认"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                updateForm('content', 'tags', [...(c.tags || []), e.target.value.trim()]);
                e.target.value = '';
              }
            }}
          />
        </div>
        <div className="settings-field">
          <label>默认标签</label>
          <input className="settings-input" value={c.defaultTag || ''} onChange={(e) => updateForm('content', 'defaultTag', e.target.value)} />
        </div>
        <div className="settings-field">
          <label className="settings-toggle-label">
            <input type="checkbox" checked={c.calendarSearch ?? true} onChange={(e) => updateForm('content', 'calendarSearch', e.target.checked)} />
            日历搜索
          </label>
        </div>
        <div className="settings-field">
          <label className="settings-toggle-label">
            <input type="checkbox" checked={c.imageCompression ?? true} onChange={(e) => updateForm('content', 'imageCompression', e.target.checked)} />
            图片压缩
          </label>
        </div>
        <div className="settings-field">
          <label className="settings-toggle-label">
            <input type="checkbox" checked={c.encryption ?? false} onChange={(e) => updateForm('content', 'encryption', e.target.checked)} />
            文章加密
          </label>
        </div>
      </div>
    );
  }

  function renderSystem() {
    const s = form.system || {};
    return (
      <div className="settings-section">
        <div className="settings-field">
          <label>时区</label>
          <select className="settings-select" value={s.timezone || 'Asia/Shanghai'} onChange={(e) => updateForm('system', 'timezone', e.target.value)}>
            <option value="Asia/Shanghai">Asia/Shanghai</option>
            <option value="Asia/Tokyo">Asia/Tokyo</option>
            <option value="America/New_York">America/New_York</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="Europe/London">Europe/London</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
        <div className="settings-field">
          <label>缩放</label>
          <input className="settings-input" type="range" min="0.8" max="1.5" step="0.05" value={s.zoom || 1} onChange={(e) => updateForm('system', 'zoom', Number(e.target.value))} />
          <span>{(s.zoom || 1).toFixed(2)}x</span>
        </div>
        <div className="settings-field">
          <label>位置 API</label>
          <input className="settings-input" value={s.locationApi || ''} onChange={(e) => updateForm('system', 'locationApi', e.target.value)} placeholder="API URL" />
        </div>
        <div className="settings-field">
          <label>天气 API</label>
          <input className="settings-input" value={s.weatherApi || ''} onChange={(e) => updateForm('system', 'weatherApi', e.target.value)} placeholder="API URL" />
        </div>
        <div className="settings-field">
          <label>页脚内容</label>
          <textarea className="settings-textarea" value={s.footer || ''} onChange={(e) => updateForm('system', 'footer', e.target.value)} />
        </div>
        <div className="settings-field">
          <button className="settings-btn settings-btn-danger" onClick={handleChangePassword}>
            修改密码
          </button>
        </div>
        <div className="settings-field">
          <button className="settings-btn settings-btn-danger" onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </div>
    );
  }

  function renderColors() {
    const c = form.colors || {};
    const colorFields = [
      { key: 'main', label: '主色' },
      { key: 'background', label: '背景色' },
      { key: 'card', label: '卡片色' },
      { key: 'card2', label: '隐藏卡片色' },
      { key: 'title', label: '标题色' },
      { key: 'content', label: '内容色' },
      { key: 'desc', label: '描述色' },
      { key: 'tool', label: '工具色' },
      { key: 'button', label: '按钮色' },
      { key: 'input', label: '输入框色' },
      { key: 'tag', label: '标签色' },
    ];
    return (
      <div className="settings-section">
        {colorFields.map(({ key, label }) => (
          <div className="settings-field settings-color-field" key={key}>
            <label>{label}</label>
            <input
              type="color"
              className="settings-color-input"
              value={c[key] || '#000000'}
              onChange={(e) => updateForm('colors', key, e.target.value)}
            />
            <input
              className="settings-input settings-color-text"
              value={c[key] || ''}
              onChange={(e) => updateForm('colors', key, e.target.value)}
            />
          </div>
        ))}
      </div>
    );
  }

  const tabRenderers = {
    personal: renderPersonal,
    website: renderWebsite,
    content: renderContent,
    system: renderSystem,
    colors: renderColors,
  };

  return (
    <div className="settings-overlay" onClick={handleClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>设置</h3>
          <button className="settings-close" onClick={handleClose}>
            <i className="icon-close" />
          </button>
        </div>
        <div className="settings-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`settings-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <i className={tab.icon} /> {tab.label}
            </button>
          ))}
        </div>
        <div className="settings-body">
          {tabRenderers[activeTab]?.()}
        </div>
        <div className="settings-footer">
          <button className="settings-btn" onClick={handleClose}>取消</button>
          <button className="settings-btn settings-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
