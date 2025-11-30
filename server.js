import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import pool from './database.js'; // ⚠️ 중요: .js 확장자를 꼭 붙여야 합니다!

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ==========================================
// 1. 회원가입 API
// 주소: POST /api/register
// ==========================================
app.post('/api/register', async (req, res) => {
    const { email, password, name, phone, address } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ message: '이메일, 비밀번호, 이름은 필수입니다.' });
    }

    try {
        const [existingUsers] = await pool.query(
            'SELECT email FROM Member WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({ message: '이미 존재하는 이메일입니다.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const insertQuery = `
            INSERT INTO Member (email, password, name, phone, address)
            VALUES (?, ?, ?, ?, ?)
        `;
        
        await pool.query(insertQuery, [email, hashedPassword, name, phone, address]);

        res.status(201).json({ message: '회원가입 성공!' });

    } catch (error) {
        console.error('회원가입 에러:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});

app.listen(PORT, async () => {
    console.log(`🚀 서버 실행 중: 포트 ${PORT}`);
    try {
        const connection = await pool.getConnection();
        console.log('✅ AWS RDS 데이터베이스 연결 성공!');
        connection.release();
    } catch (err) {
        console.error('❌ DB 연결 실패:', err);
    }
});
// ==========================================
// 2. 로그인 API
// 주소: POST /api/login
// ==========================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    // 1. 입력값 확인
    if (!email || !password) {
        return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
    }

    try {
        // 2. 사용자 조회 (이메일로 찾기)
        const [users] = await pool.query(
            'SELECT * FROM Member WHERE email = ?',
            [email]
        );

        const user = users[0];

        // 3. 사용자가 없으면 에러
        if (!user) {
            return res.status(401).json({ message: '존재하지 않는 이메일입니다.' });
        }

        // 4. 비밀번호 확인 (암호화된 비번 비교)
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: '비밀번호가 일치하지 않습니다.' });
        }

        // 5. 로그인 성공! (비밀번호 제외하고 정보 반환)
        // 실제 서비스에서는 여기서 JWT 토큰을 발급하지만, 우선 기본 기능부터 구현합니다.
        res.status(200).json({
            message: '로그인 성공!',
            user: {
                member_id: user.member_id,
                email: user.email,
                name: user.name,
                role: user.role
            }
        });

    } catch (error) {
        console.error('로그인 에러:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});
// ==========================================
// 2.5 카테고리 조회 API
// ==========================================
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM Category');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: '카테고리 조회 실패' });
    }
});
// ==========================================
// 3. 상품 목록 조회 API (카테고리 + 리뷰 평점/개수 추가)
// ==========================================
app.get('/api/products', async (req, res) => {
    try {
        const categoryId = req.query.category_id;
        
        // 상품(Product) + 카테고리(Category) + 리뷰(Review) 조인
        // IFNULL(AVG(...), 0) -> 리뷰가 없으면 0점 처리
        let query = `
            SELECT 
                p.product_id, 
                p.name, 
                p.price, 
                p.image_url, 
                c.name AS category_name,
                IFNULL(AVG(r.rating), 0) AS avg_rating,
                COUNT(r.review_id) AS review_count
            FROM Product p
            JOIN Category c ON p.category_id = c.category_id
            LEFT JOIN Review r ON p.product_id = r.product_id
        `;
        
        const params = [];

        // 카테고리 필터링
        if (categoryId && categoryId !== 'all') {
            query += ' WHERE p.category_id = ?';
            params.push(categoryId);
        }

        // 상품별로 그룹화 (이게 있어야 상품마다 통계가 나옴)
        query += ' GROUP BY p.product_id';

        const [products] = await pool.query(query, params);
        res.json(products);
    } catch (error) {
        console.error('상품 조회 에러:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});
// ==========================================
// 4. 주문하기 API (트랜잭션)
// 주소: POST /api/orders
// ==========================================
app.post('/api/orders', async (req, res) => {
    const connection = await pool.getConnection(); // 트랜잭션을 위해 커넥션 하나를 따로 꺼냄
    
    try {
        // 1. 클라이언트에서 보낸 데이터 받기
        // items 예시: [ { product_id: 1, quantity: 2 }, { product_id: 3, quantity: 1 } ]
        const { member_id, recipient_name, recipient_phone, shipping_address, payment_method, items } = req.body;

        // 필수 값 검증
        if (!member_id || !items || items.length === 0) {
            return res.status(400).json({ message: '주문할 상품이 없습니다.' });
        }

        // =====================================
        // 트랜잭션 시작 (여기서부터는 모두 한 덩어리)
        // =====================================
        await connection.beginTransaction();

        let total_price = 0; // 총 주문 금액 계산용

        // 2. 재고 확인 및 총 금액 계산 (매우 중요: 서버에서 가격을 다시 계산해야 안전함)
        for (const item of items) {
            const [rows] = await connection.query('SELECT price, stock, name FROM Product WHERE product_id = ?', [item.product_id]);
            const product = rows[0];

            if (!product) {
                throw new Error(`상품 ID ${item.product_id}을(를) 찾을 수 없습니다.`);
            }
            if (product.stock < item.quantity) {
                throw new Error(`'${product.name}' 상품의 재고가 부족합니다. (남은 수량: ${product.stock})`);
            }

            // 가격 누적
            total_price += product.price * item.quantity;
        }

        // 3. 주문 마스터(Orders) 생성
        const [orderResult] = await connection.query(`
            INSERT INTO Orders (member_id, total_price, status, recipient_name, recipient_phone, shipping_address, order_date)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [member_id, total_price, 'PAID', recipient_name, recipient_phone, shipping_address]);

        const newOrderId = orderResult.insertId; // 방금 생긴 주문 번호

        // 4. 주문 상세(OrderDetail) 저장 및 재고(Product) 감소
        for (const item of items) {
            // 4-1. 현재 상품 가격 조회 (가격 변동 대비)
            const [rows] = await connection.query('SELECT price FROM Product WHERE product_id = ?', [item.product_id]);
            const priceAtPurchase = rows[0].price;

            // 4-2. 상세 내역 저장
            await connection.query(`
                INSERT INTO OrderDetail (order_id, product_id, quantity, price_at_purchase)
                VALUES (?, ?, ?, ?)
            `, [newOrderId, item.product_id, item.quantity, priceAtPurchase]);

            // 4-3. 상품 재고 감소
            await connection.query(`
                UPDATE Product 
                SET stock = stock - ? 
                WHERE product_id = ?
            `, [item.quantity, item.product_id]);
        }

        // 5. 결제 정보(Payment) 저장
        // (실제 PG사가 없으므로 가상의 거래 ID 생성)
        const fakeTransactionId = 'PG_' + Date.now() + Math.random().toString().substr(2, 5);
        await connection.query(`
            INSERT INTO Payment (order_id, payment_method, payment_amount, payment_status, transaction_id, payment_date)
            VALUES (?, ?, ?, 'SUCCESS', ?, NOW())
        `, [newOrderId, payment_method, total_price, fakeTransactionId]);

        // 6. 장바구니(Cart) 비우기 (주문한 상품만 삭제)
        // items 배열에서 product_id들만 추출
        const orderedProductIds = items.map(item => item.product_id);
        
        // "IN (?)" 문법을 쓰기 위해 배열 처리
        await connection.query(`
            DELETE FROM Cart 
            WHERE member_id = ? AND product_id IN (?)
        `, [member_id, orderedProductIds]);


        // =====================================
        // 트랜잭션 성공 확정 (Commit)
        // =====================================
        await connection.commit();

        res.status(200).json({ 
            message: '주문이 성공적으로 완료되었습니다!',
            order_id: newOrderId,
            total_price: total_price
        });

    } catch (error) {
        // 에러 발생 시 모든 작업 취소 (Rollback)
        await connection.rollback();
        console.error('주문 실패:', error);
        res.status(500).json({ message: error.message || '주문 처리 중 오류가 발생했습니다.' });
    } finally {
        // 커넥션 반납 (필수)
        connection.release();
    }
});
// ==========================================
// 5. 장바구니 API (조회, 추가, 수정, 삭제)
// ==========================================

// 장바구니 조회 (GET)
app.get('/api/cart', async (req, res) => {
    const member_id = req.query.member_id; // 로그인한 사용자 ID
    if (!member_id) return res.status(400).json({ message: '로그인이 필요합니다.' });

    try {
        const query = `
            SELECT c.cart_id, c.product_id, c.quantity, p.name, p.price, p.image_url 
            FROM Cart c 
            JOIN Product p ON c.product_id = p.product_id 
            WHERE c.member_id = ?
        `;
        const [items] = await pool.query(query, [member_id]);
        res.json(items);
    } catch (error) {
        res.status(500).json({ message: '장바구니 조회 실패' });
    }
});

// 장바구니 추가 (POST)
app.post('/api/cart', async (req, res) => {
    const { member_id, product_id, quantity } = req.body;
    try {
        // 이미 담겨있는지 확인
        const [exists] = await pool.query(
            'SELECT cart_id, quantity FROM Cart WHERE member_id = ? AND product_id = ?',
            [member_id, product_id]
        );

        if (exists.length > 0) {
            // 있으면 수량 추가
            await pool.query(
                'UPDATE Cart SET quantity = quantity + ? WHERE cart_id = ?',
                [quantity, exists[0].cart_id]
            );
        } else {
            // 없으면 새로 추가
            await pool.query(
                'INSERT INTO Cart (member_id, product_id, quantity) VALUES (?, ?, ?)',
                [member_id, product_id, quantity]
            );
        }
        res.json({ message: '장바구니에 담았습니다.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: '장바구니 추가 실패' });
    }
});

// 장바구니 수량 수정 (PUT)
app.put('/api/cart/:cart_id', async (req, res) => {
    const { quantity } = req.body;
    try {
        await pool.query('UPDATE Cart SET quantity = ? WHERE cart_id = ?', [quantity, req.params.cart_id]);
        res.json({ message: '수정되었습니다.' });
    } catch (error) {
        res.status(500).json({ message: '수정 실패' });
    }
});

// 장바구니 삭제 (DELETE)
app.delete('/api/cart/:cart_id', async (req, res) => {
    try {
        await pool.query('DELETE FROM Cart WHERE cart_id = ?', [req.params.cart_id]);
        res.json({ message: '삭제되었습니다.' });
    } catch (error) {
        res.status(500).json({ message: '삭제 실패' });
    }
});

// ==========================================
// 6. 리뷰 API (조회, 작성)
// ==========================================

// 상품별 리뷰 조회 (GET)
app.get('/api/products/:id/reviews', async (req, res) => {
    try {
        const query = `
            SELECT r.*, m.name as reviewer_name 
            FROM Review r 
            JOIN Member m ON r.member_id = m.member_id 
            WHERE r.product_id = ? 
            ORDER BY r.created_at DESC
        `;
        const [reviews] = await pool.query(query, [req.params.id]);
        res.json(reviews);
    } catch (error) {
        res.status(500).json({ message: '리뷰 조회 실패' });
    }
});

// 리뷰 작성 (POST)
app.post('/api/reviews', async (req, res) => {
    const { member_id, product_id, rating, comment } = req.body;
    try {
        // 구매 내역 확인 (구매한 사람만 리뷰 가능하게)
        const [purchase] = await pool.query(`
            SELECT od.order_detail_id 
            FROM OrderDetail od
            JOIN Orders o ON od.order_id = o.order_id
            WHERE o.member_id = ? AND od.product_id = ?
            LIMIT 1
        `, [member_id, product_id]);

        if (purchase.length === 0) {
            return res.status(403).json({ message: '구매한 상품에만 리뷰를 쓸 수 있습니다.' });
        }

        // 리뷰 저장
        await pool.query(
            'INSERT INTO Review (member_id, product_id, order_detail_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
            [member_id, product_id, purchase[0].order_detail_id, rating, comment]
        );
        res.json({ message: '리뷰가 등록되었습니다.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: '리뷰 등록 실패' });
    }
});
// ==========================================
// 7. 마이페이지 API (주문 내역 조회)
// ==========================================
app.get('/api/mypage/orders', async (req, res) => {
    const member_id = req.query.member_id;
    if (!member_id) return res.status(400).json({ message: '로그인이 필요합니다.' });

    try {
        // 주문 정보 + 주문 상세 + 상품 정보 + 리뷰 작성 여부(review_id)를 한 번에 가져옴
        const query = `
            SELECT 
                o.order_id, 
                DATE_FORMAT(o.order_date, '%Y-%m-%d %H:%i') as order_date,
                od.order_detail_id, 
                p.product_id,
                p.name as product_name, 
                p.image_url,
                od.quantity,
                od.price_at_purchase,
                r.review_id, 
                r.rating, 
                r.comment
            FROM Orders o
            JOIN OrderDetail od ON o.order_id = od.order_id
            JOIN Product p ON od.product_id = p.product_id
            LEFT JOIN Review r ON od.order_detail_id = r.order_detail_id
            WHERE o.member_id = ?
            ORDER BY o.order_date DESC
        `;
        
        const [rows] = await pool.query(query, [member_id]);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: '주문 내역 조회 실패' });
    }
});