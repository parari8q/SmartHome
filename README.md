# Dashboard domowy

Strona-panel na komputer i telefon (np. w Fully Kiosk): zegar, pogoda, zadania, kalendarz,
witaminy, przepisy z listą zakupów, Spotify i polecenia głosowe. Dane są w Firebase Realtime
Database, więc **każde urządzenie widzi to samo na żywo**, bez odświeżania.

Adres: `https://parari8q.github.io/SmartHome/dashboard.html` (GitHub Pages, bez budowania —
wystarczy wrzucić pliki).

## Co gdzie jest

| Plik | Co robi |
|---|---|
| `dashboard.html` | szkielet strony |
| `css/app.css` | wygląd |
| `js/config.js` | **ustawienia** (miasto, adres bazy, Spotify, kafelki-linki) |
| `js/lib/firebase-sync.js` | synchronizacja z bazą (odczyt na żywo, zapisy, ponawianie bez sieci) |
| `js/logic/*.js` | logika bez interfejsu: zadania, kalendarz, witaminy, przepisy, pogoda, rozumienie mowy |
| `js/ui/*.js` | poszczególne ekrany |
| `Pieski/` | zdjęcia-nagrody za passę witamin (dowolne nazwy plików) |

Format danych w bazie się nie zmienił (`todo_lists`, `calendar_events`, `supplements_log`,
`recipes_data`, `shopping_list`), więc wszystkie stare dane działają.

## Polecenia głosowe (mikrofon w lewym dolnym rogu)

- **kalendarz**: „dentysta jutro o 15:30”, „w środę o 18 kino”, „24 grudnia wigilia”, „za 3 dni urodziny”
- **zadania**: „dodaj umyć okna w kategorii dom”, „dopisz raport do listy praca”
- **zakupy**: „dodaj mleko i chleb do listy zakupów”, „kup banany”

## Testy

```bash
npm install
npm run test:unit     # logika i synchronizacja (Node, bez przeglądarki)
npx playwright install chromium
npm run test:e2e      # cała aplikacja w przeglądarce, na komputerze i telefonie, z atrapą Firebase
npm run serve         # podgląd lokalny: http://localhost:8080/dashboard.html (prawdziwa baza!)
```

Testy e2e nie dotykają prawdziwej bazy: używają lokalnej atrapy Firebase (`tests/e2e/fake-firebase.js`).
Uruchamiają się też automatycznie na GitHubie przy każdym pushu (zakładka Actions).

## Konta i prywatność

Każde konto ma **własne dane** (w bazie pod `users/<uid>/...`). Wszystkie urządzenia zalogowane
na to samo konto widzą te same dane na żywo; inne konto ma swoje, osobne dane.
Logowanie raz na urządzeniu: Ustawienia → Konto.

Dotychczasowe dane (z czasów bez kont) przy pierwszym logowaniu właściciela kopiują się
automatycznie na jego konto. Oryginał zostaje w bazie jako kopia zapasowa.

### Konfiguracja (konsola Firebase, projekt `smarthome-cdd0e`)

1. **Authentication → Sign-in method → Email/Password → Enable**.
2. **Authentication → Users → Add user** — po jednym na osobę. UID właściciela przyda się w regułach.
3. **Authentication → Settings → User actions**: odznacz **Enable create (sign-up)**
   (nowe konta dodajesz tylko Ty, ręcznie).
4. **Realtime Database → Rules** (podmień `TWOJE_UID`) → **Publish**:

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "todo_lists":      { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "calendar_events": { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "supplements_log": { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "recipes_data":    { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "shopping_list":   { ".read": "auth != null && auth.uid === 'TWOJE_UID'" }
  }
}
```

Pierwsza część: każdy czyta i zapisuje tylko swoją przestrzeń. Druga: stare, wspólne dane może
odczytać tylko właściciel (do jednorazowego przeniesienia). Nowe konto dodane w Authentication
działa od razu, bez zmian w regułach.
