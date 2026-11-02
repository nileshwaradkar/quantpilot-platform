ALTER TABLE trades ADD COLUMN IF NOT EXISTS multiplier double precision NOT NULL DEFAULT 1 CHECK(multiplier>0);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS position_seen boolean NOT NULL DEFAULT false;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS flat_since timestamptz;

