-- =====================================================================
-- Flow Clock — trial seed data. Run AFTER the migration.
-- Dummy techs / jobs only; delete them before going live.
--
-- PINs:  all techs = 1234     Reception (admin) = 9999
-- Change a PIN:
--   update techs set pin_hash = extensions.crypt('4821', extensions.gen_salt('bf'))
--   where name = 'Dave';
-- =====================================================================

-- Cards 1–100
insert into public.cards(id, label)
select n, 'Card ' || n from generate_series(1, 100) as n
on conflict (id) do nothing;

-- 5 dummy techs + 1 admin
insert into public.techs(name, pin_hash, role) values
  ('Dave',      extensions.crypt('1234', extensions.gen_salt('bf')), 'tech'),
  ('Mick',      extensions.crypt('1234', extensions.gen_salt('bf')), 'tech'),
  ('Sarah',     extensions.crypt('1234', extensions.gen_salt('bf')), 'tech'),
  ('Tomas',     extensions.crypt('1234', extensions.gen_salt('bf')), 'tech'),
  ('Jess',      extensions.crypt('1234', extensions.gen_salt('bf')), 'tech'),
  ('Reception', extensions.crypt('9999', extensions.gen_salt('bf')), 'admin')
on conflict (name) do nothing;

-- 10 dummy jobs
insert into public.jobs(job_number, ibodyshop_ref, rego, make_model, customer_name, stage, notes) values
  ('J1001', null, '123ABC', 'Toyota Hilux SR5 2021',     'Test Customer A', 'Strip', 'LHF guard + headlamp. Check sensor bracket.'),
  ('J1002', null, '456DEF', 'Mazda CX-5 2019',            'Test Customer B', 'Panel', 'Rear bumper, tailgate. ADAS calibration after.'),
  ('J1003', null, '789GHI', 'Ford Ranger XLT 2022',       'Test Customer C', 'Paint', 'Tub side repair, blend into door.'),
  ('J1004', null, '321JKL', 'Hyundai i30 2018',           'Test Customer D', 'Arrived', 'Hail — PDR assessment.'),
  ('J1005', null, '654MNO', 'Kia Sportage 2023',          'Test Customer E', 'Prep', 'Front bar respray.'),
  ('J1006', null, '987PQR', 'Mitsubishi Triton 2020',     'Test Customer F', 'Assembly', 'Refit tray, check wiring.'),
  ('J1007', null, '147STU', 'Tesla Model 3 2022',         'Test Customer G', 'Arrived', 'EV — isolate HV before any cutting.'),
  ('J1008', null, '258VWX', 'Isuzu D-Max 2021',           'Test Customer H', 'Detail', 'Final detail + photos.'),
  ('J1009', null, '369YZA', 'Subaru Outback 2017',        'Test Customer I', 'Panel', 'RHR quarter, sill.'),
  ('J1010', null, '741BCD', 'Volkswagen Amarok 2019',     'Test Customer J', 'Booked', 'Waiting on parts.')
on conflict (job_number) do nothing;

-- Put the first 8 jobs on cards 1–8 so the trial works straight away.
insert into public.card_assignments(card_id, job_id)
select row_number() over (order by j.job_number), j.id
from public.jobs j
where j.job_number between 'J1001' and 'J1008'
  and not exists (select 1 from public.card_assignments ca where ca.job_id = j.id and ca.released_at is null)
order by j.job_number;
