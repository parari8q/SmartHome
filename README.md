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

## Konta, grupy i prywatność

- **Bez grupy** każde konto ma własne dane (`users/<uid>/...`), wspólne dla wszystkich jego urządzeń.
- **Grupa** (Ustawienia → Grupa) to kilka osób na wspólnych danych: przepisach, zakupach, zadaniach
  i kalendarzu (`groups/<id>/data/...`). Zakładający dostaje kod lub link zaproszenia, a jego
  dotychczasowe dane kopiują się do grupy. Jedna osoba należy do jednej grupy naraz. Po opuszczeniu
  grupy wraca do swoich osobistych danych.
- Nowe konta dodajesz w Firebase → Authentication → Add user (samodzielne zakładanie kont jest wyłączone).

### Powiadomienia (ntfy)

Gdy ktoś z grupy coś doda (zakupy, kalendarz, zadania, opcjonalnie przepisy), pozostałe osoby
dostają powiadomienie na telefon przez darmową aplikację **ntfy**, także gdy dashboard jest zamknięty.
Każda osoba ma własny temat, więc nie dostaje powiadomień o swoich zmianach. Konfiguracja:
Ustawienia → Powiadomienia (na Androidzie przycisk „Włącz w ntfy”, na iPhonie wpisanie tematu).
Treść powiadomień przechodzi przez publiczny serwer ntfy.sh. Temat jest długi i losowy, więc działa jak hasło.

### Reguły bazy (Firebase → Realtime Database → Rules)

Podmień `TWOJE_UID` (w 4 miejscach na dole, tylko do jednorazowego przeniesienia starych danych):

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
    "groups": {
      "$gid": {
        ".read": "auth != null && data.child('members').child(auth.uid).exists()",
        "info": {
          ".write": "auth != null && ((!data.exists() && newData.child('owner').val() === auth.uid) || data.child('owner').val() === auth.uid)"
        },
        "members": {
          "$uid": {
            ".write": "auth != null && (root.child('groups').child($gid).child('info/owner').val() === auth.uid || ($uid === auth.uid && (!newData.exists() || newData.val() === root.child('groups').child($gid).child('info/invite').val())))"
          }
        },
        "profiles": {
          "$uid": {
            ".write": "auth != null && (($uid === auth.uid && root.child('groups').child($gid).child('members').child(auth.uid).exists()) || root.child('groups').child($gid).child('info/owner').val() === auth.uid)"
          }
        },
        "data": { ".write": "auth != null && root.child('groups').child($gid).child('members').child(auth.uid).exists()" },
        "photos": { ".write": "auth != null && root.child('groups').child($gid).child('members').child(auth.uid).exists()" }
      }
    },
    "todo_lists":      { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "calendar_events": { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "recipes_data":    { ".read": "auth != null && auth.uid === 'TWOJE_UID'" },
    "shopping_list":   { ".read": "auth != null && auth.uid === 'TWOJE_UID'" }
  }
}
```

Co robią: każdy czyta i zapisuje tylko swoje dane osobiste. Dane grupy widzą i zmieniają tylko jej
członkowie. Do grupy można dołączyć wyłącznie z aktualnym kodem zaproszenia. Usuwać innych, zmieniać
nazwę i kod może tylko zakładający.
