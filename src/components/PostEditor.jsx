import { useState, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { renderMarkdown } from '../utils/markdown';
import { formatDate } from '../utils/helpers';
import * as api from '../utils/api';

const TOOLBAR_ACTIONS = [
  { icon: 'icon-bold', label: '粗体', prefix: '**', suffix: '**' },
  { icon: 'icon-italic', label: '斜体', prefix: '*', suffix: '*' },
  { icon: 'icon-strikethrough', label: '删除线', prefix: '~~', suffix: '~~' },
  { icon: 'icon-heading', label: '标题', prefix: '## ', suffix: '' },
  { icon: 'icon-quote', label: '引用', prefix: '> ', suffix: '' },
  { icon: 'icon-code', label: '代码', prefix: '`', suffix: '`' },
  { icon: 'icon-list', label: '列表', prefix: '- ', suffix: '' },
  { icon: 'icon-link', label: '链接', prefix: '[', suffix: '](url)' },
  { icon: 'icon-image', label: '图片', prefix: '![', suffix: '](url)' },
  { icon: 'icon-line', label: '分割线', prefix: '\n---\n', suffix: '' },
];

export default function PostEditor() {
  const { state, dispatch, toast, loadPosts } = useApp();
  const editing = state.editingPost;
  const [title, setTitle] = useState(editing?.title || '');
  const [content, setContent] = useState(editing?.content || '');
  const [tag, setTag] = useState(editing?.tag || state.settings.content?.defaultTag || '');
  const [date, setDate] = useState(editing?.date ? formatDate(editing.date) : formatDate(new Date()));
  const [isPinned, setIsPinned] = useState(editing?.isPinned || false);
  const [isHidden, setIsHidden] = useState(editing?.isHidden || false);
  const [isArchived, setIsArchived] = useState(editing?.isArchived || false);
  const [media, setMedia] = useState(editing?.media || []);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef(null);

  function handleClose() {
    dispatch({ type: 'SHOW_EDITOR', payload: false });
  }

  function insertText(prefix, suffix) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end);
    const before = content.slice(0, start);
    const after = content.slice(end);
    const newContent = before + prefix + selected + suffix + after;
    setContent(newContent);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + prefix.length;
      ta.selectionEnd = start + prefix.length + selected.length;
    });
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const result = await api.media.upload(file);
        setMedia((prev) => [...prev, result.url || result.path]);
        toast('上传成功', 'success');
      } catch {
        toast('上传失败', 'error');
      }
    }
  }

  function removeMedia(index) {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!title.trim()) {
      toast('请输入标题', 'warning');
      return;
    }
    setSaving(true);
    const data = { title, content, tag, date, isPinned, isHidden, isArchived, media };
    try {
      if (editing?.id) {
        await api.posts.update(editing.id, data);
        toast('文章已更新', 'success');
      } else {
        await api.posts.create(data);
        toast('文章已创建', 'success');
      }
      handleClose();
      loadPosts();
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  const previewHtml = renderMarkdown(content);

  return (
    <div className="editor-overlay">
      <div className="editor-panel">
        <div className="editor-header">
          <h3>{editing ? '编辑文章' : '写文章'}</h3>
          <button className="editor-close" onClick={handleClose}>
            <i className="icon-close" />
          </button>
        </div>
        <div className="editor-body">
          <input
            className="editor-title"
            type="text"
            placeholder="标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="editor-toolbar">
            {TOOLBAR_ACTIONS.map((action) => (
              <button
                key={action.label}
                className="editor-toolbar-btn"
                title={action.label}
                onClick={() => insertText(action.prefix, action.suffix)}
              >
                <i className={action.icon} />
              </button>
            ))}
            <div className="editor-toolbar-separator" />
            <button
              className={`editor-toolbar-btn${showPreview ? ' active' : ''}`}
              title="预览"
              onClick={() => setShowPreview(!showPreview)}
            >
              <i className="icon-eye" />
            </button>
          </div>
          <div className="editor-content-area">
            {!showPreview ? (
              <textarea
                ref={textareaRef}
                className="editor-textarea"
                placeholder="开始写作..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            ) : (
              <div className="editor-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            )}
          </div>
          <div className="editor-meta">
            <div className="editor-meta-row">
              <label className="editor-label">
                <i className="icon-tag" /> 标签
              </label>
              <input
                className="editor-input"
                type="text"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="标签"
                list="tag-suggestions"
              />
              <datalist id="tag-suggestions">
                {state.tags.map((t) => (
                  <option key={typeof t === 'string' ? t : t.name} value={typeof t === 'string' ? t : t.name} />
                ))}
              </datalist>
            </div>
            <div className="editor-meta-row">
              <label className="editor-label">
                <i className="icon-calendar" /> 日期
              </label>
              <input
                className="editor-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="editor-meta-row">
              <label className="editor-label">
                <i className="icon-image" /> 媒体
              </label>
              <input className="editor-file-input" type="file" multiple accept="image/*" onChange={handleUpload} />
            </div>
            {media.length > 0 && (
              <div className="editor-media-grid">
                {media.map((m, i) => {
                  const src = typeof m === 'string' ? m : m.url || m.src;
                  return (
                    <div className="editor-media-item" key={i}>
                      <img src={src} alt="" />
                      <button className="editor-media-remove" onClick={() => removeMedia(i)}>
                        <i className="icon-close" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="editor-toggles">
              <label className="editor-toggle">
                <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
                <i className="icon-pin" /> 置顶
              </label>
              <label className="editor-toggle">
                <input type="checkbox" checked={isHidden} onChange={(e) => setIsHidden(e.target.checked)} />
                <i className="icon-eye-off" /> 隐藏
              </label>
              <label className="editor-toggle">
                <input type="checkbox" checked={isArchived} onChange={(e) => setIsArchived(e.target.checked)} />
                <i className="icon-archive" /> 归档
              </label>
            </div>
          </div>
        </div>
        <div className="editor-footer">
          <button className="editor-btn editor-btn-cancel" onClick={handleClose}>
            取消
          </button>
          <button className="editor-btn editor-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
