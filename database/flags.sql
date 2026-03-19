-- VulnTrade Hidden Flags Table
-- This table is only discoverable via SQL injection
-- It is NOT referenced by any JPA entity or repository

CREATE TABLE IF NOT EXISTS flags (
    id SERIAL PRIMARY KEY,
    flag_name VARCHAR(50) NOT NULL,
    flag_value VARCHAR(100) NOT NULL,
    hint TEXT
);

INSERT INTO flags (flag_name, flag_value, hint) VALUES
    ('FLAG_4', 'FLAG{sql1_h1dd3n_t4bl3_fl4g}', 'You found the hidden flags table via SQL injection!'),
    ('FLAG_SECRET', 'FLAG{b0nus_y0u_dump3d_th3_wh0l3_db}', 'Bonus flag for full database enumeration'),
    ('DB_MASTER_KEY', 'FLAG{d4t4b4s3_m4st3r_k3y_3xtr4ct3d}', 'This key would be devastating in real life');
