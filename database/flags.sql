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
    ('DB_MASTER_KEY', 'FLAG{d4t4b4s3_m4st3r_k3y_3xtr4ct3d}', 'This key would be devastating in real life'),
    ('FLAG_ACCOUNT_LEVEL', 'FLAG{jwt_l3v3l_byp4ss_n0_db_ch3ck}', 'Forge JWT accountLevel claim to bypass deposit/withdraw restrictions'),
    ('FLAG_PII_JWT', 'FLAG{ssn_exposed_in_jwt}', 'Decode a Level 2 JWT to find SSN, DOB, address in claims - also the admin SSN'),
    ('FLAG_LEADERBOARD', 'FLAG{m4rk3t_m4n1pul4t0r_numb3r_0n3}', 'Reach #1 on the leaderboard. Hint: VULN symbol price is... adjustable via WebSocket admin.setPrice');
