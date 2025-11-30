import pool from './database.js';

const seedData = async () => {
    try {
        console.log("🌱 데이터 심기 시작...");

        // 1. 카테고리 데이터 넣기
        // (IGNORE는 이미 있으면 무시하라는 뜻)
        await pool.query(`
            INSERT IGNORE INTO Category (category_id, name) VALUES 
            (1, '거실가구'),
            (2, '침실가구'),
            (3, '주방가구');
        `);
        console.log("✅ 카테고리 등록 완료");

        // 2. 상품 데이터 넣기 (이케아 스타일)
        const products = [
            {
                category_id: 1,
                name: 'STRANDMON 스트란드몬',
                price: 249000,
                stock: 10,
                description: '편안한 윙체어, 노르드발라 다크그레이',
                image_url: 'https://www.ikea.com/kr/ko/images/products/strandmon-wing-chair-nordvalla-dark-grey__0325432_pe517964_s5.jpg'
            },
            {
                category_id: 1,
                name: 'LACK 라크',
                price: 15000,
                stock: 50,
                description: '보조테이블, 화이트, 55x55 cm',
                image_url: 'https://www.ikea.com/kr/ko/images/products/lack-side-table-white__0088019_pe219430_s5.jpg'
            },
            {
                category_id: 2,
                name: 'MALM 말',
                price: 199000,
                stock: 20,
                description: '높은침대프레임+수납상자2, 화이트/뤼뢰',
                image_url: 'https://www.ikea.com/kr/ko/images/products/malm-high-bed-frame-2-storage-boxes-white-luroey__0638608_pe699032_s5.jpg'
            },
            {
                category_id: 3,
                name: 'RASKOG 로스可以看出',
                price: 39900,
                stock: 100,
                description: '카트, 화이트, 35x45x78 cm',
                image_url: 'https://www.ikea.com/kr/ko/images/products/raskog-trolley-white__0102602_pe294698_s5.jpg'
            }
        ];

        for (const product of products) {
            await pool.query(`
                INSERT INTO Product (category_id, name, price, stock, description, image_url)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [product.category_id, product.name, product.price, product.stock, product.description, product.image_url]);
        }

        console.log("✅ 상품 데이터 등록 완료!");
        process.exit(0); // 끝내기

    } catch (error) {
        console.error("❌ 데이터 심기 실패:", error);
        process.exit(1);
    }
};

seedData();