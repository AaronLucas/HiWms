import express from 'express';
import routes from './routes';
const app = express();
app.use(express.json());
// 注册路由
app.use(routes);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
export default app;
