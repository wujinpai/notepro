import { AppProvider, useApp } from './context/AppContext';
import Header from './components/Header';
import Navbar from './components/Navbar';
import PostList from './components/PostList';
import PostEditor from './components/PostEditor';
import Settings from './components/Settings';
import Lightbox from './components/Lightbox';
import Toast from './components/Toast';
import BackToTop from './components/BackToTop';
import ToolsPanel from './components/ToolsPanel';
import Login from './components/Login';

function AppLayout() {
  const { state } = useApp();

  return (
    <div className="app">
      <Header />
      <Navbar />
      <main className="main-content">
        <PostList />
      </main>
      {state.showTools && <ToolsPanel />}
      {state.showEditor && <PostEditor />}
      {state.showSettings && <Settings />}
      {state.lightbox && <Lightbox />}
      <Login />
      <Toast />
      <BackToTop />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}
