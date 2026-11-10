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

## Prywatna baza (logowanie)

Strona obsługuje logowanie e-mailem i hasłem (Firebase Authentication). Gdy baza jest prywatna,
każde urządzenie loguje się **raz** na to samo konto i dalej wszystkie widzą te same dane na żywo.
Konto: Ustawienia → Konto (tam też „Wyloguj”).

Jak włączyć (konsola Firebase, projekt `smarthome-cdd0e`):

1. **Authentication → Get started → Sign-in method → Email/Password → Enable** (bez „Email link”).
2. **Authentication → Users → Add user**: Twój e-mail + hasło. Skopiuj **User UID** tego konta.
3. **Authentication → Settings → User actions**: odznacz **Enable create (sign-up)**, żeby nikt obcy
   nie mógł założyć sobie konta.
4. **Authentication → Settings → Authorized domains**: upewnij się, że jest `parari8q.github.io`.
5. Zaloguj się na stronie na **wszystkich** urządzeniach (Ustawienia → Konto → Zaloguj).
6. Dopiero teraz **Realtime Database → Rules**, wklej (podmień UID) i **Publish**:

```json
{
  "rules": {
    ".read": "auth != null && auth.uid === 'TUTAJ_WKLEJ_UID'",
    ".write": "auth != null && auth.uid === 'TUTAJ_WKLEJ_UID'"
  }
}
```

Urządzenie, które nie jest zalogowane, po zmianie reguł samo pokaże ekran logowania.
Cofnięcie: wklej z powrotem `{"rules": {".read": true, ".write": true}}`.
