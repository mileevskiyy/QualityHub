# Как загрузить QualityHub в GitHub

## Что находится в проекте

В корне репозитория должны быть `README.md`, `package.json`, `package-lock.json`, `src`, `server`, `integrations`, `tests`, `docs`, `.github`, `.gitignore`, конфигурация сборки и Docker-файлы. README на английском описывает реализованные возможности, архитектуру, технические сложности и их решения.

Не загружайте `node_modules`, `data`, `dist`, `.env`, базы данных, приватные ключи и отчёты, содержащие настоящие данные. `.gitignore` уже исключает эти пути. `.env.example` содержит только примеры и должен быть в репозитории. Тестовые пароли внутри тестов относятся к вымышленным учётным записям.

## 1. Создайте пустой репозиторий

1. Войдите в GitHub и нажмите **New repository**.
2. Назовите репозиторий **qualityhub**.
3. Описание: **Full-stack test management with versioned cases, reproducible runs, project roles and Playwright integration.**
4. Для демонстрации работодателям выберите **Public**; если сначала хотите проверить содержимое, выберите **Private**.
5. Не включайте автоматическое создание README, `.gitignore` и лицензии: первые два уже есть в проекте. Лицензию можно осознанно выбрать позже.
6. Нажмите **Create repository** и оставьте страницу открытой.

## 2. Откройте Terminal и перейдите в папку проекта

Например, если распакованная папка находится в Downloads:

```sh
cd ~/Downloads/qualityhub
```

Если используете скачанный архив, сначала распакуйте его. Можно ввести `cd ` с пробелом и перетащить распакованную папку `qualityhub` в окно Terminal, затем нажать Enter. Загружать сам ZIP как единственный файл репозитория не нужно.

## 3. Создайте первый коммит

```sh
git init -b main
git add .
git status
```

Перед следующим шагом посмотрите список файлов. В нём не должно быть `.env`, `node_modules` или `data`. Должны присутствовать `.github/workflows/ci.yml` и `package-lock.json`.

```sh
git commit -m "Build QualityHub test management application"
```

Если Git просит указать автора, задайте свои данные локально для этого репозитория:

```sh
git config user.name "Amil Milevskiy"
git config user.email "YOUR_VERIFIED_GITHUB_EMAIL"
```

Замените `YOUR_VERIFIED_GITHUB_EMAIL` на подтверждённый адрес из настроек GitHub или свой GitHub noreply-адрес. После этого повторите команду `git commit`.

## 4. Подключите репозиторий и отправьте код

Для аккаунта `mileevskiyy` и репозитория `qualityhub`:

```sh
git remote add origin https://github.com/mileevskiyy/qualityhub.git
git push -u origin main
```

Если имя аккаунта или репозитория отличается, скопируйте HTTPS-адрес из созданного репозитория и используйте его вместо примера.

Если GitHub попросит авторизацию, используйте предложенный безопасный вход через браузер или GitHub Desktop. Обычный пароль аккаунта не используется как пароль HTTPS Git. Не вставляйте токены в исходники, README, адрес remote или скриншоты. Никому не отправляйте токен или код подтверждения.

Если появляется `remote origin already exists`, сначала выполните `git remote -v` и проверьте адрес. Если он неправильный, задайте адрес созданного вами репозитория:

```sh
git remote set-url origin https://github.com/mileevskiyy/qualityhub.git
```

Затем повторите `git push -u origin main`.

## 5. Проверьте GitHub

1. Обновите страницу репозитория: README должен отображаться на главной странице, а исходники — в отдельных папках.
2. Откройте **Actions** и дождитесь выполнения **Quality checks**. Для приватных репозиториев доступность и лимиты Actions зависят от настроек аккаунта.
3. При ошибке откройте красный запуск, затем упавший шаг. Не указывайте, что CI проходит, пока этот запуск не станет зелёным.
4. В **About** добавьте темы: `react`, `typescript`, `nodejs`, `postgresql`, `playwright`, `quality-assurance`, `test-management`.
5. В профиле GitHub нажмите **Customize your pins** и закрепите репозиторий.

GitHub хранит код и показывает документацию. Загрузка репозитория не публикует работающий Node-сервер. GitHub Pages не подходит для полного приложения с серверными сессиями и базой данных.

## 6. Как запускать проект после скачивания

Нужен Node.js 24 LTS. В папке проекта выполните:

```sh
npm ci
npm run build
npm start
```

Откройте http://127.0.0.1:3100. При первом запуске создайте владельца через экран настройки. Для PostgreSQL и Docker следуйте разделу Quick start в README.

## 7. Следующие обновления

После изменения кода:

```sh
npm test
npm run build
git add .
git diff --cached --stat
git commit -m "Describe the actual change"
git push
```

Перед коммитом проверяйте, что в индекс не попали секреты или локальные данные. Сообщение коммита заменяйте конкретным описанием изменения. Не создавайте искусственную историю задним числом.

## Как описывать проект в LinkedIn и CV

**Название:** QualityHub — Full-Stack Test Management Platform

**Краткое описание:**

Developed a React/TypeScript and Node.js test-management platform with versioned test cases, immutable execution snapshots, linked defect tracking and PostgreSQL/SQLite persistence. Implemented session authentication, project-level roles and an idempotent Playwright reporting integration with retry history.

**Технические темы для интервью:** почему история исполнения хранится отдельно от текущего кейса; как обнаруживается устаревшее редактирование; где проверяются роли; почему повторный импорт не создаёт дубликаты; как транзакции объединяют несколько записей; какие ограничения есть у текущей реализации.

Добавляйте число пользователей, показатели производительности и production-опыт только после фактического запуска и измерений. Публичный репозиторий сам по себе не означает, что приложение использовали реальные команды.

Официальная инструкция GitHub: https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github
