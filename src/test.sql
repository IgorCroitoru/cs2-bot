CREATE TABLE bots (
    botId SERIAL PRIMARY KEY,
    botId64 VARCHAR(17) UNIQUE NOT NULL,
    ready BOOLEAN NOT NULL,
    items_count SMALLINT NOT NULL DEFAULT 0
);

-- Index to optimize searches by botid64
CREATE INDEX idx_botcsgo_botid64 ON botcsgo (botid64);

CREATE TABLE deposits (
    depositId SERIAL PRIMARY KEY,
    amount NUMERIC(10, 2) NOT NULL,
    botId INTEGER,
    status VARCHAR(10) NOT NULL CHECK (status IN ('pending','assigned','active', 'accepted', 'cancelled', 'declined','failed')),
    userId INTEGER NOT NULL,
    items JSONB NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX idx_deposit_botId ON deposit (botId);
CREATE INDEX idx_deposit_partnerId ON deposit (partnerId);



DO $$
BEGIN
    FOR i IN 1..100 LOOP
        INSERT INTO bots (botid64, ready, last_up_time, inventory_items)
        VALUES (
            
            substring(md5(random()::text || clock_timestamp()::text), 1, 17),  -- random botid64
            random() < 0.5,  -- random boolean for ready status (50% chance true, 50% chance false)
            now() - interval '1 day' * random(),  -- random last_up_time within the last day
            floor(random() * 1000)  -- random inventory_items between 0 and 999
        );
    END LOOP;
END $$;



DO $$
BEGIN
    FOR i IN 1..100000 LOOP
        INSERT INTO deposit (amount, botId, status, partnerId)
        VALUES(
            floor(random() * 1000 + 1)::int, -- Random amount between 0 and 1000
            (SELECT botId FROM bots ORDER BY random() LIMIT 1), -- Random botId from botcsgo table
            (ARRAY['pending','assigned','active',  'cancelled', 'declined', 'accepted'])[floor(random() * 6 + 1)], -- Random status
            (SELECT userId from users ORDER BY random() LIMIT 1) -- Random partnerId
        );
    END LOOP;
END $$;

CREATE TABLE users (
    userId SERIAL PRIMARY KEY,
    balance NUMERIC(10,2) NOT NULL,
    id64 VARCHAR(17)
)

DO $$
BEGIN
    FOR i IN 1..10000 LOOP
        INSERT INTO users (balance, id64)
        VALUES (
            floor(random() * 10000 + 1)::int,
            substring(md5(random()::text || clock_timestamp()::text), 1, 17)
        );
    END LOOP;
END $$;


select botid from bots b
where ready = true and
(select count(*) from deposit d  
where partnerid=410
 and d.botid = b.botid  and status = 'active')<5
and
(select count(*) from deposit d1
 where d1.botid=b.botid and 
 status = 'active')<30;
 


 ------
SELECT botid, (select count(*) from deposit d 
    where b.botid=d.botid and status = 'active') as active_offers
from bots b 

-----
UPDATE deposit
SET status = 'accepted'
WHERE status = 'active';
----
DO $$
DECLARE
    rec RECORD;
    cnt INT := 0;
BEGIN
    FOR rec IN 
        SELECT *
        FROM deposit
        WHERE status = 'accepted'
        ORDER BY RANDOM()
        LIMIT 1000
    LOOP
        UPDATE deposit
        SET status = 'active'
        WHERE depositId = rec.depositId;
        
        cnt := cnt + 1;
    END LOOP;
    
    RAISE NOTICE '% deposits updated to active.', cnt;
END $$;


--------------------------------
SELECT b.botid, COALESCE(d1.total_count, 0) AS total_count
FROM bots b
LEFT JOIN (
    SELECT botid, count(*) AS total_count
    FROM deposit
    WHERE status = 'active'
    GROUP BY botid
) d1 ON b.botid = d1.botid
WHERE b.ready = true
ORDER BY total_count desc;

-----------------

SELECT b.botid, COALESCE(d.partner_count, 0) AS partner_count,COALESCE(d1.total_count, 0) AS total_count
FROM bots b
LEFT JOIN (
    SELECT botid, count(*) AS partner_count
    FROM deposit
    WHERE partnerid = 410 AND status = 'active'
    GROUP BY botid
) d ON b.botid = d.botid
LEFT JOIN (
    SELECT botid, count(*) AS total_count
    FROM deposit
    WHERE status = 'active'
    GROUP BY botid
) d1 ON b.botid = d1.botid
--WHERE b.ready = true
  where COALESCE(d.partner_count, 0) < 5
  AND COALESCE(d1.total_count, 0) < 30;

----------
SELECT partnerId, count(*) as nr_deposit
FROM deposit
where status = 'active'
group by partnerId
order by nr_deposit desc;
---------------
SELECT botid, count(*) as active_deposits
from deposit
where status = 'active'
group by botid
order by active_Deposits desc;

---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_items_count() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.botId IS NOT NULL THEN
        UPDATE "BotModel"
        SET items_count = items_count + array_length(NEW.items, 1)
        WHERE botId = NEW.botId;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_botId_update
AFTER INSERT OR UPDATE OF botId
ON "DepositModel"
FOR EACH ROW
EXECUTE FUNCTION increment_items_count();
--------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION decrement_items_count() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'declined' THEN
        UPDATE "BotModel"
        SET items_count = items_count - array_length(NEW.items, 1)
        WHERE botId = NEW.botId;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-----------------------------------------------------------------------------------
CREATE TRIGGER after_status_update
AFTER UPDATE OF status
ON "DepositModel"
FOR EACH ROW
EXECUTE FUNCTION decrement_items_count();
