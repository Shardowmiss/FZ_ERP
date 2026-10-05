import { Link } from 'react-router-dom';

const ForbiddenPage = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-8xl font-bold text-gray-300">403</h1>
        <p className="text-xl text-gray-600 mt-4">抱歉，您没有权限访问此页面</p>
        <p className="text-sm text-gray-400 mt-2">请联系管理员分配相应权限</p>
        <Link
          to="/dashboard"
          className="inline-block mt-6 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary transition"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
};

export default ForbiddenPage;
