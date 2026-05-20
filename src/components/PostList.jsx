import { useApp } from '../context/AppContext';
import PostCard from './PostCard';

export default function PostList() {
  const { state } = useApp();
  const { posts, loading, columns } = state;

  if (loading) {
    return (
      <div className="post-list-loading">
        <div className="spinner" />
        <p>加载中...</p>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="post-list-empty">
        <i className="icon-note" />
        <p>暂无文章</p>
      </div>
    );
  }

  const columnArrays = Array.from({ length: columns }, () => []);
  posts.forEach((post, i) => {
    columnArrays[i % columns].push(post);
  });

  return (
    <div className={`post-list post-list-${columns}`}>
      {columnArrays.map((colPosts, ci) => (
        <div className="post-list-column" key={ci}>
          {colPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      ))}
    </div>
  );
}
