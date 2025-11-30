import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config(); // 환경변수 설정

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 연결 확인 (선택 사항)
// pool.getConnection() ... 부분은 그대로 둬도 되지만, 
// 모듈 방식에서는 보통 선언부만 깔끔하게 남깁니다.

export default pool;