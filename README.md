# Dashboard domowy

Strona-panel na komputer i telefon (np. w Fully Kiosk): zegar, pogoda, przepisy z listą zakupów,
zadania, kalendarz i polecenia głosowe. Dane są w Firebase Realtime
Database, więc **każde urządzenie widzi to samo na żywo**, bez odświeżania.

Adres: `https://parari8q.github.io/SmartHome/dashboard.html` (GitHub Pages, bez budowania —
wystarczy wrzucić pliki).

## Co gdzie jest

| Plik | Co robi |
|---|---|
| `dashboard.html` | szkielet strony |
| `css/app.css` | wygląd |
| `js/config.js` | **ustawienia** (miasto, adres bazy) |
| `js/lib/firebase-sync.js` | synchronizacja z bazą (odczyt na żywo, zapisy, ponawianie bez sieci) |
| `js/logic/*.js` | logika bez interfejsu: zadania, kalendarz, przepisy, pogoda, rozumienie mowy |
| `js/ui/*.js` | poszczególne ekrany |
| `js/logic/recipe-parser.js` | rozpoznawanie przepisu z tekstu (nazwa, porcje, czas, składniki, kroki) |
| `js/lib/ocr.js` | odczyt tekstu ze screenów/zdjęć (w przeglądarce, nic nie jest wysyłane na zewnątrz) |

Format danych w bazie się nie zmienił (`todo_lists`, `calendar_events`,
`recipes_data`, `shopping_list`), więc wszystkie stare dane działają.

## Przepisy — szybkie dodawanie

- **Ze screena lub zdjęcia** (można wybrać kilka naraz, np. przepis na 3 screenach): tekst jest
  odczytywany i sam dzieli się na nazwę, porcje, czas, składniki i kroki. Wystarczy sprawdzić i zapisać.
- **Wklej tekst** ze strony albo wiadomości — ten sam podział.
- **Na telefonie z Androidem**: zainstaluj stronę jako aplikację (Chrome → menu → „Dodaj do ekranu
  głównego”), wtedy w galerii przy screenie pojawi się „Udostępnij → Dashboard”, co otwiera nowy przepis.
- **Na komputerze**: Ctrl+V ze screenem albo przeciągnięcie plików na formularz.
- **Zdjęcie dania** zapisuje się w bazie (osobno od przepisu, więc lista ładuje się szybko).
- Szkic nowego przepisu zapisuje się sam, wyszukiwarka szuka też po składnikach, a „Tryb gotowania”
  powiększa tekst i pozwala odhaczać składniki i kroki.

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
    "recipe_photos": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "todo_lists":      { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "calendar_events": { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "recipes_data":    { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "shopping_list":   { ".read": "auth != null && auth.uid === 'TWOJE_UID'" }
  }
}
```

Pierwsza część: każdy czyta i zapisuje tylko swoją przestrzeń. Druga: stare, wspólne dane może
odczytać tylko właściciel (do jednorazowego przeniesienia). Nowe konto dodane w Authentication
działa od razu, bez zmian w regułach.
