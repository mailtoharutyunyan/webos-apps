# Dev Mode Renew

Keeps the LG webOS Developer Mode session alive by itself, with no third-party server.

A JS service on the TV reads the Developer Mode token from
`/var/luna/preferences/devmode_enabled` and calls LG's own
`ResetDevModeSession.dev` endpoint once a week, scheduled through the webOS
activity manager. The app screen shows the remaining session time
(`CheckDevModeSession.dev`) and the last renewals. The token never leaves the
TV except to `developer.lge.com`.

## Build and install

```sh
ares-package -o dist app service
ares-install -d lgtv dist/com.arayik.devrenew_1.0.0_all.ipk
```

Open **Dev Mode Renew** on the TV and select **Turn on weekly renewal**.

## Notes

- The TV runs Node 8.12 and Chromium 79: keep the code ES5 and avoid flexbox `gap`.
- Developer Mode apps may not call `activitymanager/getDetails`, so the schedule
  flag lives in the service's `state.json`.
- Renewal only runs while the TV is on. The session lasts 1000 hours (about 41 days).
