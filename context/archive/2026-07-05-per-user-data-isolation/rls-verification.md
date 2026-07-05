# Dowód izolacji danych per-konto (RLS) — C10X-1 / F-01

Ręczna, powtarzalna procedura potwierdzająca twardy guardrail: żaden użytkownik nie
widzi cudzych talii ani fiszek. Automatyczny odpowiednik powstaje w F-03
(`verification-harness`); do tego czasu ten dokument jest dowodem.

## Środowisko

- Lokalny stack Supabase (`npx supabase status` → running).
- Baza po `npx supabase db reset` (migracja `20260705180246_init_core_schema.sql` z RLS).
- Zapytania uruchamiane w kontenerze DB:
  `docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres`.

## Pułapka fałszywego PASS (dlaczego wymagany positive control)

Impersonacja użytkownika musi ustawić **rolę i claims JWT** — sam `SET ROLE` nie wystarcza,
bo `auth.uid()` czyta `sub` z `request.jwt.claims`. Jeśli pominiesz
`set request.jwt.claims`, `auth.uid()` = NULL i **każda** polityka odrzuci wszystko: A
zobaczy 0 wierszy B, ale też 0 własnych. Zero-wynik bez zdanego positive control **nie**
jest dowodem izolacji. Dowód jest ważny tylko gdy `count(*) > 0` dla danych własnych
**i jednocześnie** 0 dla danych cudzych.

## Procedura

### 1. Seed (jako owner bazy — omija RLS)

```sql
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a','a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b','b@test.dev');
insert into deck (user_id, name) values
  ('00000000-0000-0000-0000-00000000000a','Talia A'),
  ('00000000-0000-0000-0000-00000000000b','Talia B');
insert into flashcard (deck_id, state_id, front, back)
  select id, 2, 'front '||name, 'back '||name from deck;
```

### 2. Kontekst użytkownika (transakcja: `SET LOCAL` ważne i samoczyszczące)

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<UUID_A>","role":"authenticated"}';

select count(*) from deck;   -- POSITIVE CONTROL: musi być > 0 (talie A widoczne)
select name  from deck;      -- oczekiwane: wyłącznie talie A, zero talii B
select front from flashcard; -- oczekiwane: wyłącznie karty A
rollback;                    -- czyści rolę i claims; powtórz analogicznie dla B
```

### 3. Kontekst anon (bez sesji)

```sql
begin;
set local role anon;
select count(*) from deck;      -- oczekiwane: permission denied
rollback;
```

## Wynik (dowód) — 2026-07-05

### Kontekst A (`sub = ...00000000000a`)

| sprawdzenie | wynik | ocena |
| --- | --- | --- |
| `count(*) from deck` (positive control) | `1` (> 0) | ✅ widzi własne |
| `select name from deck` | `Talia A` (brak `Talia B`) | ✅ izolacja SELECT |
| `select front from flashcard` | `front Talia A` (brak karty B) | ✅ izolacja fiszek |

### Kontekst B (`sub = ...00000000000b`)

| sprawdzenie | wynik | ocena |
| --- | --- | --- |
| `count(*) from deck` (positive control) | `1` (> 0) | ✅ widzi własne |
| `select name from deck` | `Talia B` (brak `Talia A`) | ✅ izolacja SELECT |
| `select front from flashcard` | `front Talia B` (brak karty A) | ✅ izolacja fiszek |

### Kontekst anon (bez sesji)

| sprawdzenie | wynik | ocena |
| --- | --- | --- |
| `select count(*) from deck` | `ERROR: permission denied for table deck` | ✅ brak dostępu |
| `select count(*) from flashcard` | `ERROR: permission denied for table flashcard` | ✅ brak dostępu |

### Wstawienie karty do cudzej talii (WITH CHECK)

Jako A, `insert into flashcard (deck_id, ...) values (100001 /* talia B */, ...)`:

```
ERROR:  new row violates row-level security policy for table "flashcard"
```

✅ `WITH CHECK` blokuje przeniesienie/wstawienie karty do cudzej talii.

### Izolacja zapisu — UPDATE / DELETE cudzego wiersza (RLS = cisza, nie błąd)

Ważny szczegół RLS: cross-tenant `UPDATE`/`DELETE` **nie rzuca błędem**. Klauzula
`USING` po prostu nie „widzi" cudzych wierszy, więc operacja dotyka **0 wierszy**
(cichy no-op) — inaczej niż `INSERT`/`WITH CHECK`, które jawnie odrzuca. Dlatego
dowodem jest liczba dotkniętych wierszy (`DELETE 0` / `UPDATE 0`) oraz to, że rekord
ofiary pozostaje nietknięty.

Jako A (`sub = ...00000000000a`), próba na danych B:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

delete from deck where name = 'Talia B' returning name;                -- oczekiwane: 0 wierszy
update deck set name = 'hacked' where name = 'Talia B' returning name; -- oczekiwane: 0 wierszy
rollback;
```

**Uwaga (pułapka klienta):** w Supabase Studio `DELETE`/`UPDATE` bez `RETURNING` zawsze
raportują „Success. No rows returned" — niezależnie od tego, czy dotknęły 0 czy 1 wiersza.
Bez `RETURNING` nie odróżnisz zablokowanego zapisu od udanego wyłomu. Dlatego dodajemy
`returning name`: dopiero wtedy „No rows returned" = naprawdę 0 dotkniętych. (W `psql`
liczba jest wprost: `DELETE 0` / `UPDATE 0`.)

Kontrola po (jako owner bazy, poza RLS): `select name from deck where name = 'Talia B'`
→ `Talia B` nadal istnieje, nietknięta.

| sprawdzenie | wynik | ocena |
| --- | --- | --- |
| `delete from deck` (cudza talia) | `DELETE 0` | ✅ nie kasuje cudzego |
| `update deck` (cudza talia) | `UPDATE 0` | ✅ nie edytuje cudzego |
| rekord B po próbie | `Talia B` bez zmian | ✅ ofiara nietknięta |

### Kontrakt „ukryte ID" (`public_id`)

Jako A, `select public_id, name from deck` zwraca uchwyt publiczny typu uuid
(`f111a196-aa9c-4e9c-b6af-021f1a8ac240`), a nie wewnętrzny bigint `id`. Warstwy API od
S-01 wzwyż adresują rekordy przez `public_id`.

### `flashcard_state` (dane referencyjne)

Jako authenticated: `select id, code from flashcard_state` zwraca `1/2/3`;
`insert into flashcard_state ...` → `ERROR: new row violates row-level security policy`.
✅ czytelny, niezapisywalny.

## Wniosek

Twardy guardrail izolacji per-konto potwierdzony na poziomie bazy: A i B widzą wyłącznie
własne dane, `anon` nie widzi nic, `WITH CHECK` blokuje wstrzyknięcie do cudzej talii,
a publiczny uchwyt to `public_id` (uuid). Dowód ważny — positive control zdany po obu
stronach.
