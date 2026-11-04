// Bulgarian-first UI strings with an English toggle. Keys are flat dot paths; {name} placeholders interpolate.
const STRINGS = {
    bg: {
        'skip': 'Към съдържанието',
        'brand.title': 'Градски транспорт',
        'brand.city': 'Столична община',
        'brand.aria': 'Градски транспорт София, начало',
        'nav.main': 'Основна навигация',
        'nav.back': 'Назад',
        'lang.switch': 'Език',
        'tab.map': 'Карта', 'tab.plan': 'Маршрут', 'tab.lines': 'Линии', 'tab.stats': 'Статистика', 'tab.alerts': 'Съобщения',
        'live.loading': 'Зареждане…',
        'live.ok': '{n} на линия',
        'live.stale': 'Данните закъсняват',
        'live.error': 'Няма връзка',
        'pwa.install': 'Инсталирай', 'theme.dark': 'Тъмен режим',
        'pwa.offline': 'Офлайн сте. Приложението е заредено, но данните на живо не са достъпни.',
        'sheet.toggle': 'Разгъни или свий панела',
        'map.label': 'Карта', 'map.locate': 'Моето местоположение', 'map.layers': 'Слоеве',

        'unit.min': 'мин', 'unit.h': 'ч', 'unit.km': 'км', 'unit.m': 'м', 'unit.kmh': 'км/ч',
        'delay.onTime': 'навреме',
        'mode.Metro': 'Метро', 'mode.Tram': 'Трамвай', 'mode.Trolleybus': 'Тролейбус', 'mode.Bus': 'Автобус', 'mode.Unknown': 'Друг',
        'mode.Metro.pl': 'Метро', 'mode.Tram.pl': 'Трамваи', 'mode.Trolleybus.pl': 'Тролейбуси', 'mode.Bus.pl': 'Автобуси', 'mode.Unknown.pl': 'Други',

        'error.title': 'Нещо се обърка',
        'error.feedLoading': 'Разписанието се зарежда от sofiatraffic.bg. Опитайте отново след минута.',
        'error.network': 'Няма връзка със сървъра. Проверете интернет връзката си.',
        'error.generic': 'Възникна неочаквана грешка. Опитайте отново.',
        'error.locate': 'Не успяхме да определим местоположението ви.',

        'layers.show': 'Покажи', 'layers.vehicles': 'Превозни средства', 'layers.stops': 'Спирки', 'layers.modes': 'Вид транспорт',
        'legend.late3': 'Закъснение над 3 мин', 'legend.late10': 'Закъснение над 10 мин', 'legend.scheduled': 'По разписание',
        'veh.position': 'Позиция', 'veh.scheduled': 'по разписание',
        'veh.scheduledNote': 'Метрото не подава данни в реално време. Позицията е изчислена от разписанието.',
        'lines.scheduledNow': 'по разписание сега',

        'veh.delay': 'Закъснение', 'veh.noData': 'Няма данни', 'veh.next': 'Следваща спирка', 'veh.speed': 'Скорост',
        'veh.occupancy': 'Заетост', 'veh.vehicle': 'Превозно средство', 'veh.updated': 'Обновено', 'veh.showLine': 'Виж линията',
        'occ.Empty': 'Празно', 'occ.ManySeatsAvailable': 'Много свободни места', 'occ.FewSeatsAvailable': 'Малко свободни места',
        'occ.StandingRoomOnly': 'Само правостоящи', 'occ.CrushedStandingRoomOnly': 'Претъпкано', 'occ.Full': 'Пълно',
        'occ.NotAcceptingPassengers': 'Не качва пътници',

        'home.title': 'Къде отивате?',
        'home.searchPh': 'Спирка, код или адрес',
        'home.nearMe': 'Спирки около мен',
        'home.plan': 'Планирай маршрут',
        'home.inView': 'Спирки в района',
        'home.pulse': 'Мрежата в момента',
        'home.toStats': 'Цялата статистика',
        'home.onRoute': 'на линия',
        'home.delayedShare': 'закъсняват',
        'home.avgDelay': 'средно закъснение',

        'search.loading': 'Търсене…',
        'search.none': 'Няма намерени резултати',
        'search.error': 'Търсенето не е достъпно в момента',

        'stop.exits': 'Изходи на метростанцията', 'stop.planTo': 'Маршрут дотук', 'stop.planFrom': 'Маршрут оттук', 'stop.notFound': 'Спирката не е намерена',
        'stop.code': 'Код', 'stop.departures': 'Тръгвания', 'stop.updated': 'Обновено в', 'stop.noDepartures': 'Няма тръгвания скоро',
        'stop.noDeparturesText': 'През следващия час не са разписани курсове от тази спирка.',
        'stop.now': 'сега', 'stop.live': 'на живо', 'stop.scheduled': 'по разписание', 'stop.wheelchair': 'Достъпно за колички',

        'plan.title': 'Планиране на маршрут',
        'plan.from': 'Начална точка', 'plan.to': 'Крайна точка',
        'plan.fromPh': 'От: адрес, спирка или място', 'plan.toPh': 'До: адрес, спирка или място',
        'plan.swap': 'Размени началото и края',
        'plan.myLocation': 'Моето местоположение',
        'plan.mapHint': 'Можете да изберете точките и с клик върху картата.',
        'plan.mapPoint': 'Точка на картата',
        'plan.when': 'Кога',
        'plan.now': 'Сега', 'plan.departAt': 'Тръгване в', 'plan.arriveBy': 'Пристигане до',
        'plan.date': 'Дата', 'plan.time': 'Час',
        'plan.maxWalk': 'Максимално ходене',
        'plan.submit': 'Намери маршрут', 'plan.searching': 'Търсене…',
        'plan.needPlaces': 'Изберете начална и крайна точка',
        'plan.departFrom': 'Тръгване след', 'plan.arriveByAt': 'Пристигане до',
        'plan.options': 'варианта',
        'plan.transfer': 'прекачване', 'plan.transfers': 'прекачвания', 'plan.direct': 'Без прекачване',
        'plan.enterVia': 'Влизане от', 'plan.leaveVia': 'Излизане от', 'plan.walkOnly': 'Само пеша', 'plan.walking': 'Пеша', 'plan.walk': 'Пеша',
        'plan.towards': 'посока', 'plan.getOff': 'Слезте на',
        'plan.stop': 'спирка', 'plan.stops': 'спирки',
        'plan.msg.no-stops-nearby': 'Няма спирки наблизо',
        'plan.msg.no-stops-nearby.text': 'Няма спирка в обхвата на пешеходното разстояние. Увеличете максималното ходене или изберете друга точка.',
        'plan.msg.no-connection': 'Няма намерен маршрут',
        'plan.msg.no-connection.text': 'Не открихме връзка в този час. Опитайте друг час или по-дълго ходене.',
        'plan.msg.no-service': 'Няма разписание за тази дата',
        'plan.msg.no-service.text': 'Публикуваното разписание не покрива избраната дата.',

        'lines.title': 'Линии', 'lines.searchPh': 'Номер или крайна спирка', 'lines.all': 'Всички линии',
        'lines.none': 'Няма такава линия', 'lines.noneText': 'Опитайте с друг номер или вид транспорт.',
        'lines.liveNow': 'на линия сега', 'lines.direction': 'Посока',
        'lines.tripsToday': 'Курсове днес', 'lines.firstLast': 'Първи – последен',
        'lines.stops': 'Спирки', 'lines.approaching': 'приближава',
        'lines.punctuality': 'Точност на линията',
        'lines.noService': 'Линията няма курсове', 'lines.notFound': 'Линията не е намерена',

        'alerts.title': 'Съобщения за промени',
        'alerts.intro': 'Текущи съобщения от Центъра за градска мобилност за отклонения, ремонти и промени в движението.',
        'alerts.filterPh': 'Търси по линия или текст',
        'alerts.from': 'от', 'alerts.until': 'до',
        'alerts.more': 'Покажи още', 'alerts.less': 'Покажи по-малко',
        'alerts.source': 'Към източника',
        'alerts.none': 'Няма активни съобщения', 'alerts.noneText': 'В момента движението е без обявени промени.',
        'alerts.noMatch': 'Няма съобщения, отговарящи на търсенето',
        'effect.NoService': 'Спряно движение', 'effect.ReducedService': 'Намалено движение', 'effect.SignificantDelays': 'Закъснения',
        'effect.Detour': 'Обходен маршрут', 'effect.AdditionalService': 'Допълнителни курсове', 'effect.ModifiedService': 'Промяна в движението',
        'effect.OtherEffect': 'Промяна', 'effect.UnknownEffect': 'Промяна', 'effect.StopMoved': 'Преместена спирка',
        'effect.NoEffect': 'Информация', 'effect.AccessibilityIssue': 'Достъпност',

        'stats.title': 'Точност на градския транспорт',
        'stats.intro': 'Закъснения на превозните средства, изчислени от данните в реално време на sofiatraffic.bg спрямо публикуваното разписание. Историята се натрупва в базата данни на всеки няколко минути.',
        'stats.noCharts': 'Библиотеката за графики не се зареди. Проверете връзката и презаредете страницата.',
        'stats.range': 'Период',
        'stats.range.6h': '6 ч', 'stats.range.24h': '24 ч', 'stats.range.7d': '7 дни', 'stats.range.30d': '30 дни',
        'stats.now': 'В момента',
        'stats.onRoute': 'На линия сега', 'stats.asOf': 'към', 'stats.stale': 'данните закъсняват',
        'stats.delayedNow': 'Закъсняват над {min} мин', 'stats.ofTracked': 'от проследените',
        'stats.avgDelay': 'Средно закъснение', 'stats.median': 'медиана',
        'stats.p90': '90-и персентил', 'stats.max': 'макс.',
        'stats.severe': 'Над {min} мин', 'stats.early': 'подранили',
        'stats.alerts': 'Активни съобщения', 'stats.seeAlerts': 'Виж съобщенията',
        'stats.trend': 'Закъснение във времето',
        'stats.trendNote': 'Средно закъснение и брой закъсняващи превозни средства за периода.',
        'stats.distribution': 'Разпределение сега',
        'stats.distributionNote': 'Брой превозни средства по закъснение в минути.',
        'stats.period': 'Обобщение за периода',
        'stats.samples': '{n} измервания · {from} – {to}',
        'stats.avgDelayed': 'Средно закъсняващи', 'stats.ofAvg': 'от средно {n} на линия',
        'stats.onTimeShare': 'Навреме', 'stats.delayedShort': 'закъсняват', 'stats.severeShort': 'сериозно',
        'stats.peak': 'Пик на закъсненията',
        'stats.byHour': 'По час от деня', 'stats.byHourNote': 'Средно закъснение и дял на закъсняващите по час.',
        'stats.byMode': 'По вид транспорт', 'stats.byModeNote': 'Средно закъснение за периода.',
        'stats.modeDetail': 'ср. {veh} на линия · {delayed} закъсняват ({share})',
        'stats.worstLines': 'Линии с най-голямо закъснение', 'stats.worstLinesNote': 'Топ 15 по средно закъснение. Изберете линия за подробности.',
        'stats.byWeekday': 'По ден от седмицата', 'stats.byWeekdayNote': 'Средно закъснение за всеки ден.',
        'stats.allLines': 'Всички линии', 'stats.allLinesNote': 'Подредете по колона; изберете ред за графика на линията.',
        'stats.col.line': 'Линия', 'stats.col.mode': 'Вид', 'stats.col.avgDelay': 'Ср. закъснение, мин', 'stats.col.delayedShare': 'Закъсняват',
        'stats.col.maxDelay': 'Макс., мин', 'stats.col.vehicles': 'Ср. на линия',
        'stats.lineSummary': 'Средно {avg} мин · {share} закъсняват · максимум {max} мин',
        'stats.onMap': 'На картата', 'stats.close': 'Затвори',
        'stats.vehicles': 'Превозни средства', 'stats.delayedVehicles': 'Закъсняващи', 'stats.delayedShare': 'Дял закъсняващи, %',
        'stats.avgDelayMin': 'Ср. закъснение, мин', 'stats.p90Min': '90-и персентил, мин', 'stats.delayMin': 'Закъснение, мин',
        'stats.collecting': 'Данните се натрупват',
        'stats.collectingText': 'Приложението записва измерване на всеки няколко минути. Графиките ще се попълнят скоро.',
        'stats.noLive': 'Няма данни в реално време',
        'stats.source': 'Източник: Център за градска мобилност, GTFS и GTFS-Realtime (gtfs.sofiatraffic.bg), лиценз CC BY 4.0. Закъснението е разликата между прогнозното и разписаното време за следващата спирка.',
    },
    en: {
        'skip': 'Skip to content',
        'brand.title': 'Public Transport',
        'brand.city': 'Sofia Municipality',
        'brand.aria': 'Sofia Public Transport, home',
        'nav.main': 'Main navigation',
        'nav.back': 'Back',
        'lang.switch': 'Language',
        'tab.map': 'Map', 'tab.plan': 'Journey', 'tab.lines': 'Lines', 'tab.stats': 'Statistics', 'tab.alerts': 'Alerts',
        'live.loading': 'Loading…',
        'live.ok': '{n} in service',
        'live.stale': 'Data delayed',
        'live.error': 'Offline',
        'pwa.install': 'Install', 'theme.dark': 'Dark mode',
        'pwa.offline': 'You are offline. The app is available, but live data cannot be reached.',
        'sheet.toggle': 'Expand or collapse the panel',
        'map.label': 'Map', 'map.locate': 'My location', 'map.layers': 'Layers',

        'unit.min': 'min', 'unit.h': 'h', 'unit.km': 'km', 'unit.m': 'm', 'unit.kmh': 'km/h',
        'delay.onTime': 'on time',
        'mode.Metro': 'Metro', 'mode.Tram': 'Tram', 'mode.Trolleybus': 'Trolleybus', 'mode.Bus': 'Bus', 'mode.Unknown': 'Other',
        'mode.Metro.pl': 'Metro', 'mode.Tram.pl': 'Trams', 'mode.Trolleybus.pl': 'Trolleybuses', 'mode.Bus.pl': 'Buses', 'mode.Unknown.pl': 'Other',

        'error.title': 'Something went wrong',
        'error.feedLoading': 'The timetable is loading from sofiatraffic.bg. Try again in a minute.',
        'error.network': 'Cannot reach the server. Check your connection.',
        'error.generic': 'An unexpected error occurred. Please try again.',
        'error.locate': 'We could not determine your location.',

        'layers.show': 'Show', 'layers.vehicles': 'Vehicles', 'layers.stops': 'Stops', 'layers.modes': 'Transport type',
        'legend.late3': 'Over 3 min late', 'legend.late10': 'Over 10 min late', 'legend.scheduled': 'Scheduled',
        'veh.position': 'Position', 'veh.scheduled': 'from timetable',
        'veh.scheduledNote': 'The metro publishes no realtime data. This position is estimated from the timetable.',
        'lines.scheduledNow': 'scheduled now',

        'veh.delay': 'Delay', 'veh.noData': 'No data', 'veh.next': 'Next stop', 'veh.speed': 'Speed',
        'veh.occupancy': 'Occupancy', 'veh.vehicle': 'Vehicle', 'veh.updated': 'Updated', 'veh.showLine': 'Show line',
        'occ.Empty': 'Empty', 'occ.ManySeatsAvailable': 'Many seats free', 'occ.FewSeatsAvailable': 'Few seats free',
        'occ.StandingRoomOnly': 'Standing room only', 'occ.CrushedStandingRoomOnly': 'Crowded', 'occ.Full': 'Full',
        'occ.NotAcceptingPassengers': 'Not boarding',

        'home.title': 'Where to?',
        'home.searchPh': 'Stop, code or address',
        'home.nearMe': 'Stops near me',
        'home.plan': 'Plan a journey',
        'home.inView': 'Stops in this area',
        'home.pulse': 'The network right now',
        'home.toStats': 'All statistics',
        'home.onRoute': 'in service',
        'home.delayedShare': 'running late',
        'home.avgDelay': 'average delay',

        'search.loading': 'Searching…',
        'search.none': 'No results found',
        'search.error': 'Search is unavailable right now',

        'stop.exits': 'Station exits', 'stop.planTo': 'Journey to here', 'stop.planFrom': 'Journey from here', 'stop.notFound': 'Stop not found',
        'stop.code': 'Code', 'stop.departures': 'Departures', 'stop.updated': 'Updated at', 'stop.noDepartures': 'No departures soon',
        'stop.noDeparturesText': 'No trips are scheduled from this stop within the next hour.',
        'stop.now': 'now', 'stop.live': 'live', 'stop.scheduled': 'scheduled', 'stop.wheelchair': 'Wheelchair accessible',

        'plan.title': 'Journey planner',
        'plan.from': 'Start', 'plan.to': 'Destination',
        'plan.fromPh': 'From: address, stop or place', 'plan.toPh': 'To: address, stop or place',
        'plan.swap': 'Swap start and destination',
        'plan.myLocation': 'My location',
        'plan.mapHint': 'You can also pick the points by clicking the map.',
        'plan.mapPoint': 'Point on map',
        'plan.when': 'When',
        'plan.now': 'Now', 'plan.departAt': 'Depart at', 'plan.arriveBy': 'Arrive by',
        'plan.date': 'Date', 'plan.time': 'Time',
        'plan.maxWalk': 'Maximum walk',
        'plan.submit': 'Find journeys', 'plan.searching': 'Searching…',
        'plan.needPlaces': 'Choose a start and a destination',
        'plan.departFrom': 'Departing after', 'plan.arriveByAt': 'Arriving by',
        'plan.options': 'options',
        'plan.transfer': 'transfer', 'plan.transfers': 'transfers', 'plan.direct': 'Direct',
        'plan.enterVia': 'Enter at', 'plan.leaveVia': 'Leave at', 'plan.walkOnly': 'Walk only', 'plan.walking': 'Walk', 'plan.walk': 'Walk',
        'plan.towards': 'towards', 'plan.getOff': 'Get off at',
        'plan.stop': 'stop', 'plan.stops': 'stops',
        'plan.msg.no-stops-nearby': 'No stops nearby',
        'plan.msg.no-stops-nearby.text': 'No stop is within walking range. Increase the maximum walk or choose another point.',
        'plan.msg.no-connection': 'No journey found',
        'plan.msg.no-connection.text': 'We found no connection at this time. Try another time or a longer walk.',
        'plan.msg.no-service': 'No timetable for this date',
        'plan.msg.no-service.text': 'The published timetable does not cover the selected date.',

        'lines.title': 'Lines', 'lines.searchPh': 'Number or terminus', 'lines.all': 'All lines',
        'lines.none': 'No such line', 'lines.noneText': 'Try another number or transport type.',
        'lines.liveNow': 'in service now', 'lines.direction': 'Direction',
        'lines.tripsToday': 'Trips today', 'lines.firstLast': 'First – last',
        'lines.stops': 'Stops', 'lines.approaching': 'approaching',
        'lines.punctuality': 'Line punctuality',
        'lines.noService': 'This line has no trips', 'lines.notFound': 'Line not found',

        'alerts.title': 'Service alerts',
        'alerts.intro': 'Current notices from the Urban Mobility Center about diversions, works and service changes.',
        'alerts.filterPh': 'Filter by line or text',
        'alerts.from': 'from', 'alerts.until': 'until',
        'alerts.more': 'Show more', 'alerts.less': 'Show less',
        'alerts.source': 'Open source',
        'alerts.none': 'No active alerts', 'alerts.noneText': 'Service is currently running without announced changes.',
        'alerts.noMatch': 'No alerts match your filter',
        'effect.NoService': 'No service', 'effect.ReducedService': 'Reduced service', 'effect.SignificantDelays': 'Delays',
        'effect.Detour': 'Detour', 'effect.AdditionalService': 'Extra service', 'effect.ModifiedService': 'Service change',
        'effect.OtherEffect': 'Change', 'effect.UnknownEffect': 'Change', 'effect.StopMoved': 'Stop moved',
        'effect.NoEffect': 'Information', 'effect.AccessibilityIssue': 'Accessibility',

        'stats.title': 'Public transport punctuality',
        'stats.intro': 'Vehicle delays computed from sofiatraffic.bg realtime data against the published timetable. History is stored in the database every few minutes.',
        'stats.noCharts': 'The chart library did not load. Check your connection and reload the page.',
        'stats.range': 'Period',
        'stats.range.6h': '6 h', 'stats.range.24h': '24 h', 'stats.range.7d': '7 days', 'stats.range.30d': '30 days',
        'stats.now': 'Right now',
        'stats.onRoute': 'In service now', 'stats.asOf': 'as of', 'stats.stale': 'data delayed',
        'stats.delayedNow': 'Over {min} min late', 'stats.ofTracked': 'of tracked',
        'stats.avgDelay': 'Average delay', 'stats.median': 'median',
        'stats.p90': '90th percentile', 'stats.max': 'max',
        'stats.severe': 'Over {min} min', 'stats.early': 'running early',
        'stats.alerts': 'Active alerts', 'stats.seeAlerts': 'See alerts',
        'stats.trend': 'Delay over time',
        'stats.trendNote': 'Average delay and number of late vehicles across the period.',
        'stats.distribution': 'Distribution now',
        'stats.distributionNote': 'Vehicles by delay in minutes.',
        'stats.period': 'Period summary',
        'stats.samples': '{n} samples · {from} – {to}',
        'stats.avgDelayed': 'Late on average', 'stats.ofAvg': 'of {n} in service on average',
        'stats.onTimeShare': 'On time', 'stats.delayedShort': 'late', 'stats.severeShort': 'severely',
        'stats.peak': 'Peak late vehicles',
        'stats.byHour': 'By hour of day', 'stats.byHourNote': 'Average delay and share of late vehicles per hour.',
        'stats.byMode': 'By transport type', 'stats.byModeNote': 'Average delay for the period.',
        'stats.modeDetail': 'avg {veh} in service · {delayed} late ({share})',
        'stats.worstLines': 'Most delayed lines', 'stats.worstLinesNote': 'Top 15 by average delay. Pick a line for details.',
        'stats.byWeekday': 'By day of week', 'stats.byWeekdayNote': 'Average delay per day.',
        'stats.allLines': 'All lines', 'stats.allLinesNote': 'Sort by any column; pick a row for the line chart.',
        'stats.col.line': 'Line', 'stats.col.mode': 'Type', 'stats.col.avgDelay': 'Avg delay, min', 'stats.col.delayedShare': 'Late',
        'stats.col.maxDelay': 'Max, min', 'stats.col.vehicles': 'Avg in service',
        'stats.lineSummary': 'Average {avg} min · {share} late · max {max} min',
        'stats.onMap': 'On the map', 'stats.close': 'Close',
        'stats.vehicles': 'Vehicles', 'stats.delayedVehicles': 'Late vehicles', 'stats.delayedShare': 'Late share, %',
        'stats.avgDelayMin': 'Avg delay, min', 'stats.p90Min': '90th percentile, min', 'stats.delayMin': 'Delay, min',
        'stats.collecting': 'Collecting data',
        'stats.collectingText': 'The app records a sample every few minutes. Charts will fill in shortly.',
        'stats.noLive': 'No realtime data',
        'stats.source': 'Source: Sofia Urban Mobility Center, GTFS and GTFS-Realtime (gtfs.sofiatraffic.bg), CC BY 4.0. Delay is the difference between predicted and scheduled time at the next stop.',
    },
};

const KEY = 'stm.lang';
let current = (() => {
    const saved = localStorage.getItem(KEY);
    return saved === 'en' || saved === 'bg' ? saved : 'bg';
})();
const listeners = new Set();

export const lang = () => current;

export function t(key, vars) {
    let s = STRINGS[current][key] ?? STRINGS.bg[key];
    if (s == null) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
    return s;
}

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setLang(next) {
    if (next === current || !STRINGS[next]) return;
    current = next;
    localStorage.setItem(KEY, next);
    applyStatic();
    listeners.forEach(fn => fn(next));
}

/** Translate the static shell: [data-i18n] text, [data-i18n-aria] labels, [data-i18n-title] tooltips. */
export function applyStatic(root = document) {
    document.documentElement.lang = current;
    document.title = current === 'en' ? 'Sofia Public Transport' : 'Градски транспорт София';
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
        if (!el.hasAttribute('data-i18n-aria')) el.setAttribute('aria-label', el.title);
    });
    root.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === current)));
}
