// 알림을 받아 보여 주는 서비스 워커. 화면 캐시나 오프라인 처리는 하지 않는다.

self.addEventListener('push', (event) => {
  let news = {}
  try {
    news = event.data?.json() ?? {}
  } catch {
    // 본문이 없거나 깨졌어도 알림 하나는 보여 준다 (보여 주지 않으면 브라우저가 구독을 끊을 수 있다).
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(news.title || '거북이 도서관', { body: news.body || '', tag: news.tag, icon: 'icon-512.png' })
      // 앱이 열려 있으면 바로 새 소식을 받아 오게 한다.
      for (const tab of await self.clients.matchAll({ type: 'window' })) tab.postMessage('refresh')
    })(),
  )
})

// 알림을 누르면 열려 있는 앱으로 가고, 없으면 새로 연다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      return tabs.length ? tabs[0].focus() : self.clients.openWindow('./')
    })(),
  )
})
