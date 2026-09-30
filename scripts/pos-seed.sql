-- POS seed: 1 store + 3 employees (scrypt pin 123456)
BEGIN;
INSERT INTO pos_store (id, name, code, status, address, phone) VALUES
  ('S001', '萧山旗舰店', 'STORE01', 'active', '杭州市萧山区', '0571-88888888');
INSERT INTO pos_employee (name, code, role, store_id, status, password_hash) VALUES
  ('张收银', '1001', 'cashier', 'S001', 'active', 'scrypt$21fe6d499359b099f53115cd237ab562$8e4b322d97337bdbcee82381f006480467b7e7f6025112e7833fdda937d840d051f80517ae13dd6ea481a083e5bda877247bbe526a18bae0c7cd6a8cbfbcfea3'),
  ('李店长', '2002', 'manager', 'S001', 'active', 'scrypt$417cf995fc9e3e8b59cf651a4de621c2$6b02b5b8c4e573588ecce28c954f2be7b84538b74da71ba2bd1de694fc785ee2fcf0da6285ae18253119e5e83de04d739a434a17e8b4eca09dfd699916e6e5bd'),
  ('王督导', '3003', 'supervisor', 'S001', 'active', 'scrypt$4386ff3d8c9ce089c6053f753ee6c40e$add7977990f8017571cd255c74c0fb424443393e8e7c0c463383d808df6f1399a974a201432ada8d193798530b6b529c6ca2b05e283995f31c1f32708e0f73c0');
COMMIT;
