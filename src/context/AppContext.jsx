import { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import * as api from '../utils/api';

const AppContext = createContext(null);

const defaultSettings = {
  personal: {
    avatar: '',
    background: '',
    nickname: 'NotePro',
    signature: '记录生活，分享美好',
    email: '',
    social: { github: '', twitter: '', weibo: '', zhihu: '' },
  },
  website: {
    name: 'NotePro',
    description: '个人笔记博客',
    keywords: '笔记,博客',
    postsPerPage: 10,
    viewRange: 'all',
  },
  content: {
    tags: [],
    defaultTag: '',
    calendarSearch: true,
    imageCompression: true,
    encryption: false,
  },
  system: {
    timezone: 'Asia/Shanghai',
    zoom: 1,
    locationApi: '',
    weatherApi: '',
    password: '',
    footer: '',
  },
  colors: {
    main: '#39393a',
    background: '#f7f7f7',
    card: '#ffffff',
    card2: '#9891cd',
    title: '#39393a',
    content: '#39393a',
    desc: '#7a7a7a',
    tool: '#f1f1f1',
    button: '#29adff',
    input: '#707070',
    tag: '#8f8f8f',
  },
};

const initialState = {
  settings: defaultSettings,
  isLoggedIn: false,
  posts: [],
  tags: [],
  currentTag: null,
  searchQuery: '',
  currentDate: null,
  showSettings: false,
  showEditor: false,
  showTools: false,
  toolsType: null,
  editingPost: null,
  lightbox: null,
  toasts: [],
  loading: false,
  columns: 1,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_SETTINGS':
      return { ...state, settings: { ...defaultSettings, ...action.payload } };
    case 'SET_LOGGED_IN':
      return { ...state, isLoggedIn: action.payload };
    case 'SET_POSTS':
      return { ...state, posts: action.payload };
    case 'SET_TAGS':
      return { ...state, tags: action.payload };
    case 'SET_CURRENT_TAG':
      return { ...state, currentTag: action.payload };
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.payload };
    case 'SET_CURRENT_DATE':
      return { ...state, currentDate: action.payload };
    case 'SHOW_SETTINGS':
      return { ...state, showSettings: action.payload };
    case 'SHOW_EDITOR':
      return { ...state, showEditor: action.payload, editingPost: action.post || null };
    case 'SHOW_TOOLS':
      return { ...state, showTools: action.payload, toolsType: action.toolsType || null };
    case 'SET_LIGHTBOX':
      return { ...state, lightbox: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_COLUMNS':
      return { ...state, columns: action.payload };
    case 'ADD_TOAST':
      return { ...state, toasts: [...state.toasts, { id: Date.now(), ...action.payload }] };
    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.payload) };
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const toast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random();
    dispatch({ type: 'ADD_TOAST', payload: { id, message, type, duration } });
    if (duration > 0) {
      setTimeout(() => dispatch({ type: 'REMOVE_TOAST', payload: id }), duration);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.settings.get();
      const settings = data.settings || data;
      dispatch({ type: 'SET_SETTINGS', payload: settings });
      if (settings.colors) {
        applyColors(settings.colors);
      }
    } catch {
      applyColors(defaultSettings.colors);
    }
  }, []);

  const loadPosts = useCallback(async (params = {}) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await api.posts.list(params);
      dispatch({ type: 'SET_POSTS', payload: data.posts || data || [] });
    } catch {
      dispatch({ type: 'SET_POSTS', payload: [] });
      toast('加载文章失败', 'error');
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [toast]);

  const loadTags = useCallback(async () => {
    try {
      const data = await api.tags.list();
      dispatch({ type: 'SET_TAGS', payload: data.tags || data.data || data || [] });
    } catch {
      dispatch({ type: 'SET_TAGS', payload: [] });
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const data = await api.auth.status();
      dispatch({ type: 'SET_LOGGED_IN', payload: !!data.authenticated });
    } catch {
      dispatch({ type: 'SET_LOGGED_IN', payload: false });
    }
  }, []);

  const login = useCallback(async (password) => {
    try {
      await api.auth.login(password);
      dispatch({ type: 'SET_LOGGED_IN', payload: true });
      toast('登录成功', 'success');
      return true;
    } catch {
      toast('密码错误', 'error');
      return false;
    }
  }, [toast]);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
      dispatch({ type: 'SET_LOGGED_IN', payload: false });
      toast('已退出登录', 'info');
    } catch {
      toast('退出失败', 'error');
    }
  }, [toast]);

  const filterByTag = useCallback(async (tag) => {
    dispatch({ type: 'SET_CURRENT_TAG', payload: tag });
    if (!tag) {
      loadPosts();
      return;
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await api.posts.byTag(tag);
      dispatch({ type: 'SET_POSTS', payload: data.posts || data || [] });
    } catch {
      toast('加载标签文章失败', 'error');
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [loadPosts, toast]);

  const filterByDate = useCallback(async (date) => {
    dispatch({ type: 'SET_CURRENT_DATE', payload: date });
    if (!date) {
      loadPosts();
      return;
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await api.posts.byDate(date);
      dispatch({ type: 'SET_POSTS', payload: data.posts || data || [] });
    } catch {
      toast('加载日期文章失败', 'error');
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [loadPosts, toast]);

  const searchPosts = useCallback(async (query) => {
    dispatch({ type: 'SET_SEARCH_QUERY', payload: query });
    if (!query) {
      loadPosts();
      return;
    }
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const data = await api.posts.search(query);
      dispatch({ type: 'SET_POSTS', payload: data.posts || data || [] });
    } catch {
      toast('搜索失败', 'error');
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [loadPosts, toast]);

  const openLightbox = useCallback((images, index = 0) => {
    dispatch({ type: 'SET_LIGHTBOX', payload: { images, index } });
  }, []);

  const closeLightbox = useCallback(() => {
    dispatch({ type: 'SET_LIGHTBOX', payload: null });
  }, []);

  useEffect(() => {
    loadSettings();
    checkAuth();
    loadPosts();
    loadTags();
  }, [loadSettings, checkAuth, loadPosts, loadTags]);

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      let cols = 1;
      if (w >= 1600) cols = 3;
      else if (w >= 1240) cols = 2;
      dispatch({ type: 'SET_COLUMNS', payload: cols });
    }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const value = {
    state,
    dispatch,
    toast,
    loadSettings,
    loadPosts,
    loadTags,
    checkAuth,
    login,
    logout,
    filterByTag,
    filterByDate,
    searchPosts,
    openLightbox,
    closeLightbox,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

function applyColors(colors) {
  const root = document.documentElement;
  const map = {
    main: '--MAIN_COLOR',
    background: '--BACKGROUND_COLOR',
    card: '--CARD_COLOR',
    card2: '--CARD2_COLOR',
    title: '--TITLE_COLOR',
    content: '--CONTENT_COLOR',
    desc: '--DESC_COLOR',
    tool: '--TOOL_COLOR',
    button: '--BUTTON_COLOR',
    input: '--INPUT_COLOR',
    tag: '--TAG_COLOR',
  };
  for (const [key, cssVar] of Object.entries(map)) {
    if (colors[key]) {
      root.style.setProperty(cssVar, colors[key]);
    }
  }
}

export default AppContext;
