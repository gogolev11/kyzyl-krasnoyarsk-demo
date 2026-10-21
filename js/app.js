/* Прототип бронирования Кызыл — Абакан — Красноярск.
   Всё работает в браузере: без сервера, без оплаты, без отправки данных.
   Брони хранятся в localStorage этого браузера. */
(function () {
  'use strict';

  var STORE_KEY = 'hiace-demo-v1';
  var DATA = null;
  var app = document.getElementById('app');
  var memStore = null;     // если localStorage недоступен
  var timerId = null;

  // ---------- Хранилище ----------
  function emptyState() { return { bookings: [], boarded: {} }; }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : emptyState();
    } catch (e) { return memStore || emptyState(); }
  }
  var state = loadState();
  function save() {
    memStore = state;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* остаётся в памяти */ }
  }

  // ---------- Поиск (состояние экрана) ----------
  var search = { dir: 'to_krs', from: 'KYZ', to: 'KRS', date: null };
  var seatPick = { tripId: null, from: null, to: null, seats: [], name: '', phone: '' };
  var carrierUi = { date: null, tripId: null, tab: 'seats', seat: null, from: null, to: null };

  // ---------- Утилиты ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseIso(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(iso, n) { var d = parseIso(iso); d.setDate(d.getDate() + n); return isoDate(d); }
  function today() { return isoDate(new Date()); }
  function dayIndex(iso) { var p = iso.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  var WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function dateLabel(iso) { var d = parseIso(iso); return WD[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function money(n) { return n.toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₽'; }
  function hm(min) { return pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60); }
  function dur(min) { var h = Math.floor(min / 60), m = min % 60; return h + ' ч' + (m ? ' ' + m + ' мин' : ''); }
  function stopName(id) { return DATA.stops[id].name; }
  function seatWord(n) {
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'место';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'места';
    return 'мест';
  }
  function allSeats() {
    var s = DATA.seatLayout.front ? [DATA.seatLayout.front] : [];
    DATA.seatLayout.rows.forEach(function (r) { s = s.concat(r); });
    return s;
  }
  function priceOf(a, b) {
    for (var i = 0; i < DATA.prices.length; i++) {
      var p = DATA.prices[i];
      if ((p.a === a && p.b === b) || (p.a === b && p.b === a)) return p.price;
    }
    return 0;
  }
  function rng(seedStr) {
    var h = 2166136261;
    for (var i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h += 0x6D2B79F5; var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function newCode() { return 'КК-' + (1000 + Math.floor(Math.random() * 9000)); }

  // ---------- Рейсы ----------
  function allDrivers() { return DATA.drivers.concat(state.extraDrivers || []); }
  function driverFor(tripId, date) {
    var list = allDrivers();
    var over = (state.driverOverride || {})[tripId];
    var d = list.filter(function (x) { return x.id === over; })[0];
    // по умолчанию водители меняются каждый оборот (туда и обратно)
    return d || DATA.drivers[Math.floor(dayIndex(date) / 2) % DATA.drivers.length];
  }
  function makeTrip(date, s) {
    var p = s.depart.split(':');
    var id = date + '_' + s.id;
    var d = driverFor(id, date);
    return {
      id: id, date: date, sched: s, dir: s.direction,
      stops: DATA.directions[s.direction].stops,
      start: +p[0] * 60 + +p[1],
      crew: { driverId: d.id, driver: d.name, phone: d.phone, vehicle: DATA.vehicle.model, plate: DATA.vehicle.plate }
    };
  }
  function runsOn(s, date) { return !s.days || s.days.indexOf(parseIso(date).getDay()) >= 0; }
  var WDFULL = ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам'];
  function daysText(dir) {
    var s = DATA.schedule.filter(function (x) { return x.direction === dir; })[0];
    return s && s.days ? 'по ' + s.days.map(function (k) { return WDFULL[k]; }).join(' и ') + ', выезд в ' + s.depart : '';
  }
  function pointsOf(trip, sid) { return (trip.sched.points && trip.sched.points[sid]) || []; }
  function pointOf(trip, sid) { var p = pointsOf(trip, sid)[0]; return p ? p.name : ''; }
  function approx(trip, k) { return (trip.sched.approx || []).indexOf(k) >= 0; }
  function tripsFor(date, dir) {
    return DATA.schedule.filter(function (s) { return (!dir || s.direction === dir) && runsOn(s, date); })
      .map(function (s) { return makeTrip(date, s); })
      .sort(function (a, b) { return a.start - b.start; });
  }
  function tripById(id) {
    var parts = id.split('_');
    var s = DATA.schedule.filter(function (x) { return x.id === parts[1]; })[0];
    return s ? makeTrip(parts[0], s) : null;
  }
  // Абсолютное время на остановке k: минуты от полуночи даты рейса
  function at(trip, k, kind) {
    var t = trip.sched.times[k];
    var off = kind === 'arr' ? t.arr : (t.dep != null ? t.dep : t.arr);
    return trip.start + off;
  }
  function clock(trip, abs) {
    var day = Math.floor(abs / 1440);
    return { t: hm(abs), date: addDays(trip.date, day), plus: day };
  }
  function legsOf(trip, from, to) {
    var i = trip.stops.indexOf(from), j = trip.stops.indexOf(to), r = [];
    for (var k = i; k < j; k++) r.push(k);
    return r;
  }
  function departed(trip, from) {
    var k = trip.stops.indexOf(from);
    var c = clock(trip, at(trip, k, 'dep'));
    var p = c.t.split(':');
    var d = parseIso(c.date); d.setHours(+p[0], +p[1]);
    return d.getTime() < Date.now();
  }

  // ---------- Брони и занятость ----------
  var FIRST = ['Айдыс', 'Чечек', 'Ирина', 'Сайзана', 'Олег', 'Аржаана', 'Наталья', 'Буян', 'Елена', 'Шолбан', 'Марина', 'Начын', 'Дмитрий', 'Айлана', 'Ольга'];
  var LAST = ['М.', 'О.', 'К.', 'Д.', 'С.', 'Т.', 'Б.', 'Х.'];
  function seedBookings(trip) {
    var r = rng(trip.id);
    var ahead = Math.max(0, dayIndex(trip.date) - dayIndex(today()));
    var fill = Math.max(0.2, 0.85 - ahead * 0.06);
    var out = [];
    allSeats().forEach(function (seat) {
      var x = r();
      if (x > fill) return;
      var y = r(), from, to;
      if (y < 0.5) { from = trip.stops[0]; to = trip.stops[2]; }
      else if (y < 0.78) { from = trip.stops[0]; to = trip.stops[1]; }
      else { from = trip.stops[1]; to = trip.stops[2]; }
      var name = FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)];
      out.push({
        id: 'seed-' + trip.id + '-' + seat, code: 'КК-' + (1000 + Math.floor(r() * 9000)),
        tripId: trip.id, from: from, to: to, seats: [seat], name: name,
        phone: '+7 900 0' + pad(Math.floor(r() * 99)) + '-' + pad(Math.floor(r() * 99)) + '-' + pad(Math.floor(r() * 99)),
        status: r() < 0.2 ? 'phone' : 'paid', source: 'seed'
      });
    });
    return out;
  }
  function purgeHolds() {
    var now = Date.now(), before = state.bookings.length;
    state.bookings = state.bookings.filter(function (b) { return b.status !== 'held' || b.holdUntil > now; });
    if (state.bookings.length !== before) save();
  }
  function tripBookings(trip) {
    purgeHolds();
    var removed = state.removedSeeds || {};
    return seedBookings(trip).filter(function (b) { return !removed[b.id]; })
      .concat(state.bookings.filter(function (b) { return b.tripId === trip.id; }));
  }
  // seat -> [booking на участке 0, booking на участке 1]
  function occupancy(trip, bookings) {
    var map = {};
    allSeats().forEach(function (s) { map[s] = []; });
    bookings.forEach(function (b) {
      legsOf(trip, b.from, b.to).forEach(function (leg) {
        b.seats.forEach(function (s) { map[s][leg] = b; });
      });
    });
    return map;
  }
  function freeCount(trip, from, to, occ) {
    var legs = legsOf(trip, from, to), n = 0;
    allSeats().forEach(function (s) {
      if (legs.every(function (l) { return !occ[s][l]; })) n++;
    });
    return n;
  }
  function findBooking(id) { return state.bookings.filter(function (b) { return b.id === id; })[0]; }

  // ---------- Общие куски разметки ----------
  function timelineHtml(trip, from, to) {
    var i = trip.stops.indexOf(from), j = trip.stops.indexOf(to);
    return '<ol class="timeline">' + trip.stops.map(function (sid, k) {
      var on = k >= i && k <= j;
      var segOn = k >= i && k < j;
      var t;
      if (k === 0) t = clock(trip, at(trip, 0, 'dep')).t;
      else if (k === trip.stops.length - 1) t = clock(trip, at(trip, k, 'arr')).t;
      else t = clock(trip, at(trip, k, 'arr')).t + '–' + clock(trip, at(trip, k, 'dep')).t;
      if (approx(trip, k)) t = '≈' + t;
      var c = clock(trip, at(trip, k, k === 0 ? 'dep' : 'arr'));
      var plus = c.plus ? ' <small class="muted">' + dateLabel(c.date) + '</small>' : '';
      var leg = '';
      if (k < trip.stops.length - 1) {
        var d = at(trip, k + 1, 'arr') - at(trip, k, 'dep');
        leg = '<span class="leg">в пути ' + dur(d) + (k + 1 < trip.stops.length - 1 ? '' : '') + '</span>';
      }
      var note = (k > 0 && k < trip.stops.length - 1) ? ' <small class="muted">' + (approx(trip, k) ? 'время уточняется' : 'стоянка ' +
        (at(trip, k, 'dep') - at(trip, k, 'arr')) + ' мин') + '</small>' : '';
      var pts = pointsOf(trip, sid);
      var ptsHtml = pts.length ? '<span class="pts">' + pts.map(function (p) {
        return '<span>' + (p.t != null && pts.length > 1 ? '<b class="num">' + hm(trip.start + p.t) + '</b> ' : '') + esc(p.name) + '</span>';
      }).join('') + '</span>' : '';
      return '<li class="' + (on ? 'on ' : '') + (segOn ? 'seg-on' : '') + '"><span class="stopname">' +
        esc(stopName(sid)) + note + '</span><span class="t num">' + t + plus + '</span>' + ptsHtml + leg + '</li>';
    }).join('') + '</ol>';
  }
  function crewHtml(trip) {
    var c = trip.crew;
    return '<div class="crew"><div>Водитель рейса: <b>' + esc(c.driver) + '</b>, <a href="tel:' +
      c.phone.replace(/[^\d+]/g, '') + '">' + esc(c.phone) + '</a></div><div class="muted">' +
      esc(c.vehicle) + ', ' + esc(c.plate) + '</div><div class="muted small">Вопросы по поездке — сразу водителю этого рейса.</div></div>';
  }
  function legendHtml(carrier) {
    return '<div class="legend"><span><i></i>свободно</span><span><i class="l-busy"></i>занято</span>' +
      (carrier ? '<span><i class="l-phone"></i>продано по телефону</span>' : '<span><i class="l-sel"></i>ваш выбор</span>') +
      '<span><i class="l-bar"></i>полоски: занятость до Абакана и после</span><span><i class="l-door"></i>дверь</span></div>';
  }
  // Схема салона. opts: {trip, occ, legs, selected[], carrier, picked}
  function vanHtml(o) {
    function seatBtn(s) {
      var cells = o.occ[s];
      var busy = o.legs.some(function (l) { return !!cells[l]; });
      var sel = o.selected.indexOf(s) >= 0;
      var bars = [0, 1].map(function (l) {
        var b = cells[l];
        var cls = !b ? '' : (b.status === 'held' ? 'h' : (b.status === 'phone' ? 'p' : 'b'));
        return '<i class="' + cls + '"></i>';
      }).join('');
      var partial = !busy && (cells[0] || cells[1]);
      var cls = 'seat' + (busy ? ' busy' : '') + (sel ? ' sel' : '') + (partial ? ' partial' : '') +
        (o.carrier ? ' carrier' : '') + (o.picked === s ? ' picked' : '');
      var label = 'Место ' + s + (busy ? ', занято' : ', свободно') + (sel ? ', выбрано' : '');
      var dis = busy && !o.carrier ? ' disabled' : '';
      return '<button type="button" class="' + cls + '" data-seat="' + s + '" aria-label="' + label +
        '" aria-pressed="' + (sel || o.picked === s) + '"' + dis + '><span class="n">' + s + '</span><span class="bars">' + bars + '</span></button>';
    }
    var cab = '<div class="driver"><span class="wheel"></span>водитель</div><div class="empty-slot"></div>' + (DATA.seatLayout.front ? seatBtn(DATA.seatLayout.front) : '<div class="driver">не продаётся</div>');
    var rows = DATA.seatLayout.rows.map(function (r) { return r.map(seatBtn).join(''); }).join('');
    return '<div class="van" role="group" aria-label="Схема салона Toyota HiAce"><span class="van-door"></span>' +
      '<div class="van-cab">' + cab + '</div><div class="van-rows">' + rows + '</div></div>';
  }
  function setNav(name) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === name);
    });
  }

  // ---------- Экран 1: поиск и список рейсов ----------
  function viewHome() {
    setNav('home');
    if (!search.date) search.date = today();
    var dir = DATA.directions[search.dir];
    var stops = dir.stops;
    var fi = stops.indexOf(search.from), ti = stops.indexOf(search.to);

    var routeHtml = '<div class="route" aria-hidden="true">' + stops.map(function (sid, k) {
      var on = k >= fi && k <= ti, end = k === fi || k === ti;
      var tag = k === fi ? 'посадка' : (k === ti ? 'высадка' : (on ? 'проезд, стоянка' : ''));
      return '<div class="route-stop' + (on ? ' on' : '') + (end ? ' end' : '') + '"><span class="route-dot"></span>' +
        '<span class="route-name">' + esc(stopName(sid)) + '</span><span class="route-tag">' + tag + '</span></div>';
    }).join('') + '</div>';

    var fromChips = stops.slice(0, -1).map(function (sid) {
      return '<button type="button" class="chip" data-from="' + sid + '" aria-pressed="' + (sid === search.from) + '">' + esc(stopName(sid)) + '</button>';
    }).join('');
    var toChips = stops.slice(1).map(function (sid) {
      var dis = stops.indexOf(sid) <= fi ? ' disabled' : '';
      return '<button type="button" class="chip" data-to="' + sid + '" aria-pressed="' + (sid === search.to) + '"' + dis + '>' + esc(stopName(sid)) + '</button>';
    }).join('');

    var dates = '';
    for (var i = 0; i < 14; i++) {
      var iso = addDays(today(), i), d = parseIso(iso);
      dates += '<button type="button" class="date" data-date="' + iso + '" aria-pressed="' + (iso === search.date) + '"><span>' +
        (i === 0 ? 'сегодня' : (i === 1 ? 'завтра' : WD[d.getDay()])) + '</span><b class="num">' + d.getDate() + '</b><span>' + MON[d.getMonth()] + '</span></button>';
    }

    var price = priceOf(search.from, search.to);
    var trips = tripsFor(search.date, search.dir).map(function (trip) {
      var occ = occupancy(trip, tripBookings(trip));
      var free = freeCount(trip, search.from, search.to, occ);
      var gone = departed(trip, search.from);
      var fk = trip.stops.indexOf(search.from), tk = trip.stops.indexOf(search.to);
      var dep = clock(trip, at(trip, fk, 'dep')), arr = clock(trip, at(trip, tk, 'arr'));
      var total = at(trip, tk, 'arr') - at(trip, fk, 'dep');
      var freeCls = free === 0 ? 'none' : (free <= 3 ? 'low' : '');
      var btn = gone ? '<span class="muted small">Уже отправился</span>' :
        (free === 0 ? '<span class="free none">Мест нет</span>' :
          '<a class="btn btn-primary" href="#/trip/' + trip.id + '?from=' + search.from + '&to=' + search.to + '">Выбрать места</a>');
      return '<article class="trip' + (gone ? ' gone' : '') + '">' +
        '<div class="trip-head"><div class="trip-times num">' + dep.t + ' → ' + arr.t +
        (arr.plus ? ' <small>прибытие ' + dateLabel(arr.date) + '</small>' : '') + '</div><div class="trip-dur">' + dur(total) + '</div></div>' +
        timelineHtml(trip, search.from, search.to) + crewHtml(trip) +
        '<div class="trip-foot"><div><div class="price num">' + money(price) + '</div><div class="free ' + freeCls + '">' +
        (free ? 'Свободно ' + free + ' из ' + allSeats().length : '') + '</div></div>' + btn + '</div></article>';
    }).join('');

    function noTripHtml() {
      var next = null;
      for (var k = 1; k < 30 && !next; k++) {
        var dt = addDays(search.date, k);
        if (tripsFor(dt, search.dir).length) next = dt;
      }
      return '<div class="panel"><p style="margin-top:0">В этот день рейса ' + esc(DATA.directions[search.dir].label) +
        ' нет. Рейсы ' + esc(DATA.directions[search.dir].label) + ' ' + esc(daysText(search.dir)) + '.</p>' +
        (next ? '<button type="button" class="btn btn-primary" data-date="' + next + '">Ближайший рейс: ' + dateLabel(next) + '</button>' : '') + '</div>';
    }
    var mine = state.bookings.filter(function (b) { return b.source === 'site' && b.status === 'paid'; }).slice(-3).reverse();
    var mineHtml = mine.length ? '<h2>Мои брони в этом браузере</h2><ul class="blist">' + mine.map(function (b) {
      var t = tripById(b.tripId);
      return '<li><div class="top"><a href="#/done/' + b.id + '">' + esc(b.code) + '</a><span>' + dateLabel(t.date) + '</span></div><div class="small">' +
        esc(stopName(b.from)) + ' → ' + esc(stopName(b.to)) + ', места ' + b.seats.join(', ') + '</div></li>';
    }).join('') + '</ul>' : '';

    app.innerHTML =
      '<h1>Билеты на микроавтобус</h1><p class="lead">Toyota HiAce, ' + allSeats().length + ' мест. Рейсы из Кызыла ' + esc(daysText('to_krs')) + ', из Красноярска ' + esc(daysText('to_kyz')) + '. Можно ехать весь путь, только до Абакана или из Абакана. У каждого рейса указан телефон его водителя.</p>' +
      '<div class="panel stack">' +
      '<div class="seg" role="group" aria-label="Направление">' + Object.keys(DATA.directions).map(function (k) {
        return '<button type="button" data-dir="' + k + '" aria-pressed="' + (k === search.dir) + '">' + esc(DATA.directions[k].label) + '</button>';
      }).join('') + '</div>' + routeHtml +
      '<div><p class="label">Откуда</p><div class="chips">' + fromChips + '</div></div>' +
      '<div><p class="label">Куда</p><div class="chips">' + toChips + '</div></div>' +
      '</div>' +
      '<h2>Дата отправления</h2><div class="dates">' + dates + '</div>' +
      '<h2>Рейсы на ' + dateLabel(search.date) + '</h2>' + (trips || noTripHtml()) + mineHtml;

    app.onclick = function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.dataset.dir) {
        search.dir = t.dataset.dir;
        var s = DATA.directions[search.dir].stops; search.from = s[0]; search.to = s[2];
      } else if (t.dataset.from) {
        search.from = t.dataset.from;
        var st = DATA.directions[search.dir].stops;
        if (st.indexOf(search.to) <= st.indexOf(search.from)) search.to = st[st.indexOf(search.from) + 1];
      } else if (t.dataset.to) { search.to = t.dataset.to; }
      else if (t.dataset.date) { search.date = t.dataset.date; }
      else return;
      var y = window.scrollY; viewHome(); window.scrollTo(0, y);
    };
  }

  // ---------- Экран 2: выбор мест и данные пассажира ----------
  function viewTrip(tripId, q) {
    setNav('home');
    var trip = tripById(tripId);
    if (!trip) return notFound();
    var from = q.get('from') || trip.stops[0], to = q.get('to') || trip.stops[2];
    if (seatPick.tripId !== tripId || seatPick.from !== from || seatPick.to !== to) {
      seatPick = { tripId: tripId, from: from, to: to, seats: [], name: seatPick.name, phone: seatPick.phone };
    }
    var occ = occupancy(trip, tripBookings(trip));
    var legs = legsOf(trip, from, to);
    // если выбранное место успели занять — снимаем выбор
    seatPick.seats = seatPick.seats.filter(function (s) { return legs.every(function (l) { return !occ[s][l]; }); });
    var price = priceOf(from, to), n = seatPick.seats.length, total = price * n;
    var fk = trip.stops.indexOf(from);
    var dep = clock(trip, at(trip, fk, 'dep'));
    var segNote = legs.length === 1
      ? 'Вы едете только по участку ' + esc(stopName(from)) + ' — ' + esc(stopName(to)) + '. Место, занятое на другом участке, для вас свободно.'
      : 'Вы едете весь путь: место должно быть свободно на обоих участках.';
    var valid = n > 0 && seatPick.name.trim().length >= 2 && seatPick.phone.replace(/\D/g, '').length >= 10;

    app.innerHTML =
      '<a class="back" href="#/">← К рейсам</a>' +
      '<h1>' + esc(stopName(from)) + ' → ' + esc(stopName(to)) + '</h1>' +
      '<p class="lead">' + dateLabel(dep.date) + ', отправление в <b class="num">' + dep.t + '</b></p>' +
      '<div class="trip">' + timelineHtml(trip, from, to) + crewHtml(trip) + '</div>' +
      '<h2>Выберите места</h2><p class="note">' + segNote + '</p><div style="height:12px"></div>' +
      vanHtml({ trip: trip, occ: occ, legs: legs, selected: seatPick.seats, carrier: false }) + legendHtml(false) +
      '<h2>Пассажир</h2><div class="panel stack">' +
      '<p class="note warn">Это демо. Не вводите настоящие данные: подойдёт любое имя и номер.</p>' +
      '<div class="field"><label for="pname">Имя и фамилия</label><input id="pname" autocomplete="off" value="' + esc(seatPick.name) + '" placeholder="Например, Тест Тестов"></div>' +
      '<div class="field"><label for="pphone">Телефон</label><input id="pphone" type="tel" inputmode="tel" autocomplete="off" value="' + esc(seatPick.phone) + '" placeholder="+7 900 000-00-00"></div>' +
      '<button type="button" class="linkbtn" data-fill>Заполнить тестовыми данными</button>' +
      '</div>' +
      '<h2>Итого</h2><div class="panel"><dl class="sum">' +
      '<dt>Участок</dt><dd>' + esc(stopName(from)) + ' → ' + esc(stopName(to)) + '</dd>' +
      '<dt>Цена за место</dt><dd class="num">' + money(price) + '</dd>' +
      '<dt>Места</dt><dd class="num">' + (n ? seatPick.seats.slice().sort(function (a, b) { return a - b; }).join(', ') : '—') + '</dd>' +
      '<dt class="total">К оплате</dt><dd class="total num">' + money(total) + '</dd></dl>' +
      '<p class="small muted">Предоплата 100%. После перехода к оплате места удерживаются за вами ' + DATA.holdMinutes + ' минут.</p>' +
      '<button type="button" class="btn btn-primary btn-block" data-hold' + (valid ? '' : ' disabled') + '>' +
      (n ? 'Перейти к оплате, ' + money(total) : 'Выберите место на схеме') + '</button>' +
      (n && !valid ? '<p class="small muted">Заполните имя и телефон (не меньше 10 цифр).</p>' : '') + '</div>';

    function rerender() { var y = window.scrollY; viewTrip(tripId, q); window.scrollTo(0, y); }
    app.oninput = function (e) {
      if (e.target.id === 'pname') seatPick.name = e.target.value;
      if (e.target.id === 'pphone') seatPick.phone = e.target.value;
      var ok = seatPick.seats.length > 0 && seatPick.name.trim().length >= 2 && seatPick.phone.replace(/\D/g, '').length >= 10;
      var b = app.querySelector('[data-hold]'); if (b) b.disabled = !ok;
    };
    app.onclick = function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.dataset.seat) {
        var s = +t.dataset.seat, i = seatPick.seats.indexOf(s);
        if (i >= 0) seatPick.seats.splice(i, 1); else seatPick.seats.push(s);
        rerender();
      } else if (t.hasAttribute('data-fill')) {
        seatPick.name = 'Тест Тестов'; seatPick.phone = '+7 900 000-12-34'; rerender();
      } else if (t.hasAttribute('data-hold')) {
        // перепроверяем занятость в момент удержания
        var occ2 = occupancy(trip, tripBookings(trip));
        var clash = seatPick.seats.filter(function (s) { return legs.some(function (l) { return !!occ2[s][l]; }); });
        if (clash.length) { alert('Место ' + clash.join(', ') + ' только что заняли. Выберите другое.'); return rerender(); }
        var b = {
          id: 'b' + Date.now(), code: newCode(), tripId: tripId, from: from, to: to,
          seats: seatPick.seats.slice().sort(function (a, b) { return a - b; }),
          name: seatPick.name.trim(), phone: seatPick.phone.trim(), status: 'held', source: 'site',
          price: price, total: price * seatPick.seats.length,
          createdAt: Date.now(), holdUntil: Date.now() + DATA.holdMinutes * 60000
        };
        state.bookings.push(b); save();
        seatPick.seats = [];
        location.hash = '#/pay/' + b.id;
      }
    };
  }

  // ---------- Экран 3: оплата (имитация) ----------
  function viewPay(id) {
    setNav('home');
    purgeHolds();
    var b = findBooking(id);
    if (!b) {
      app.innerHTML = '<h1>Время удержания истекло</h1><p class="lead">Места освобождены и снова доступны другим пассажирам. Бронь не создана, деньги не списаны.</p>' +
        '<a class="btn btn-primary" href="#/">Выбрать рейс заново</a>';
      return;
    }
    if (b.status !== 'held') { location.hash = '#/done/' + id; return; }
    var trip = tripById(b.tripId);
    var dep = clock(trip, at(trip, trip.stops.indexOf(b.from), 'dep'));
    app.innerHTML =
      '<h1>Оплата</h1><p class="lead">Места ' + b.seats.join(', ') + ' удерживаются за вами. Если не оплатить, они освободятся автоматически.</p>' +
      '<div class="panel stack"><div class="timer num" id="timer">--:--</div>' +
      '<dl class="sum"><dt>Рейс</dt><dd>' + esc(stopName(b.from)) + ' → ' + esc(stopName(b.to)) + '</dd>' +
      '<dt>Отправление</dt><dd class="num">' + dateLabel(dep.date) + ', ' + dep.t + '</dd>' +
      '<dt>Пассажир</dt><dd>' + esc(b.name) + '</dd>' +
      '<dt>Места</dt><dd class="num">' + b.seats.join(', ') + '</dd>' +
      '<dt class="total">К оплате</dt><dd class="total num">' + money(b.total) + '</dd></dl>' +
      '<div class="paybox">Здесь будет страница платёжного сервиса (банковская карта, СБП).<br>В демо карта не нужна и деньги не списываются.</div>' +
      '<button type="button" class="btn btn-primary btn-block" data-pay>Оплатить ' + money(b.total) + ' (демо)</button>' +
      '<button type="button" class="btn btn-ghost btn-block" data-cancel>Отменить и освободить места</button>' +
      '<button type="button" class="linkbtn" data-expire>Показать, что будет, если не оплатить (демо)</button></div>';

    function tick() {
      var b2 = findBooking(id);
      if (!b2 || b2.holdUntil <= Date.now()) { clearInterval(timerId); purgeHolds(); return viewPay(id); }
      var left = Math.ceil((b2.holdUntil - Date.now()) / 1000);
      var el = document.getElementById('timer');
      if (el) { el.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60); el.classList.toggle('low', left < 120); }
    }
    clearInterval(timerId); tick(); timerId = setInterval(tick, 1000);

    app.onclick = function (e) {
      var t = e.target.closest('button'); if (!t) return;
      var bk = findBooking(id); if (!bk) return viewPay(id);
      if (t.hasAttribute('data-pay')) {
        bk.status = 'paid'; bk.paidAt = Date.now(); delete bk.holdUntil; save();
        clearInterval(timerId); location.hash = '#/done/' + id;
      } else if (t.hasAttribute('data-cancel')) {
        state.bookings = state.bookings.filter(function (x) { return x.id !== id; }); save();
        clearInterval(timerId); location.hash = '#/';
      } else if (t.hasAttribute('data-expire')) {
        bk.holdUntil = Date.now() - 1; save(); tick();
      }
    };
  }

  // ---------- Экран 4: бронь подтверждена + Telegram ----------
  function tgMessages(b, trip) {
    var fk = trip.stops.indexOf(b.from), tk = trip.stops.indexOf(b.to);
    var dep = clock(trip, at(trip, fk, 'dep')), arr = clock(trip, at(trip, tk, 'arr'));
    var c = trip.crew;
    var occ = occupancy(trip, tripBookings(trip));
    var freeLines = [0, 1].map(function (l) {
      var n = allSeats().filter(function (s) { return !occ[s][l]; }).length;
      return stopName(trip.stops[l]) + '–' + stopName(trip.stops[l + 1]) + ': ' + n;
    }).join('\n');
    var passenger =
      '✅ Бронь ' + b.code + ' оплачена\n\n' +
      '🚐 ' + stopName(b.from) + ' → ' + stopName(b.to) + '\n' +
      '📅 ' + dateLabel(dep.date) + ', отправление в ' + dep.t + '\n' +
      '📍 Посадка: ' + stopName(b.from) + ', ' + pointOf(trip, b.from) + '\n' +
      '🏁 Прибытие: ' + arr.t + (arr.plus ? ' (' + dateLabel(arr.date) + ')' : '') + '\n' +
      '💺 Места: ' + b.seats.join(', ') + '\n' +
      '👤 Водитель: ' + c.driver + ', ' + c.phone + '\n' +
      '🚗 ' + c.vehicle + ', ' + c.plate + '\n' +
      '💳 Оплачено: ' + money(b.total) + '\n\n' +
      'Приходите за 15 минут до отправления.';
    var driver =
      '🆕 Новая бронь ' + b.code + '\n\n' +
      'Рейс: ' + dateLabel(trip.date) + ', ' + hm(trip.start) + ', ' + DATA.directions[trip.dir].label + '\n' +
      'Посадка: ' + stopName(b.from) + ' в ' + dep.t + '\n' +
      'Высадка: ' + stopName(b.to) + '\n' +
      'Места: ' + b.seats.join(', ') + '\n' +
      'Пассажир: ' + b.name + ', ' + b.phone + '\n' +
      'Оплачено онлайн: ' + money(b.total) + '\n\n' +
      'Свободно мест сейчас:\n' + freeLines;
    return { passenger: passenger, driver: driver };
  }
  function tgCard(title, sub, initials, text, buttons) {
    var now = new Date();
    return '<div class="tg"><div class="tg-head"><div class="tg-ava">' + initials + '</div><div><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div></div>' +
      '<div class="tg-body"><div class="tg-msg">' + esc(text) + '<span class="tg-time">' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + '</span></div>' +
      (buttons ? '<div class="tg-btns">' + buttons.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '') +
      '</div></div>';
  }
  function viewDone(id) {
    setNav('home');
    var b = findBooking(id);
    if (!b || b.status !== 'paid') return notFound();
    var trip = tripById(b.tripId);
    var m = tgMessages(b, trip);
    var dep = clock(trip, at(trip, trip.stops.indexOf(b.from), 'dep'));
    app.innerHTML =
      '<div class="okmark" aria-hidden="true">✓</div><h1 style="text-align:center">Бронь подтверждена</h1>' +
      '<p class="code num">' + esc(b.code) + '</p>' +
      '<div class="panel"><dl class="sum">' +
      '<dt>Рейс</dt><dd>' + esc(stopName(b.from)) + ' → ' + esc(stopName(b.to)) + '</dd>' +
      '<dt>Отправление</dt><dd class="num">' + dateLabel(dep.date) + ', ' + dep.t + '</dd>' +
      '<dt>Посадка</dt><dd>' + esc(pointOf(trip, b.from)) + '</dd>' +
      '<dt>Места</dt><dd class="num">' + b.seats.join(', ') + '</dd>' +
      '<dt>Пассажир</dt><dd>' + esc(b.name) + '</dd>' +
      '<dt>Оплачено (демо)</dt><dd class="num">' + money(b.total) + '</dd></dl>' + crewHtml(trip) + '</div>' +
      '<h2>Уведомления в Telegram</h2><p class="lead">Так сообщения будут выглядеть в боевой версии. В демо они никуда не отправляются.</p>' +
      '<h3>У пассажира</h3>' + tgCard('Кызыл — Красноярск, бот', 'бот перевозчика (пример)', 'КК', m.passenger, ['Отменить бронь', 'Позвонить водителю']) +
      '<h3>У водителя и перевозчика</h3>' + tgCard('Брони: ' + trip.crew.driver, 'служебный чат (пример)', 'Б', m.driver, ['Посадочная ведомость', 'Позвонить пассажиру']) +
      '<div class="stack" style="margin-top:20px"><a class="btn btn-primary btn-block" href="#/">Купить ещё билет</a>' +
      '<a class="btn btn-ghost btn-block" href="#/carrier?trip=' + trip.id + '">Открыть страницу перевозчика</a></div>';
    app.onclick = null;
  }

  // ---------- Экран 5: страница перевозчика ----------
  function viewCarrier(q) {
    setNav('carrier');
    if (q && q.get('trip') && carrierUi.tripId !== q.get('trip')) {
      carrierUi.tripId = q.get('trip'); carrierUi.date = q.get('trip').split('_')[0]; carrierUi.seat = null;
    }
    if (!carrierUi.date) carrierUi.date = today();
    var trips = tripsFor(carrierUi.date);
    if (!trips.length) {
      // в выбранный день рейсов нет — переходим на ближайший день с рейсом
      for (var nd = 1; nd < 30 && !trips.length; nd++) {
        var cand = addDays(carrierUi.date, nd);
        if (tripsFor(cand).length) { carrierUi.date = cand; trips = tripsFor(cand); }
      }
      carrierUi.tripId = null;
    }
    if (!carrierUi.tripId || carrierUi.tripId.split('_')[0] !== carrierUi.date) carrierUi.tripId = trips[0].id;
    var trip = tripById(carrierUi.tripId);
    var bookings = tripBookings(trip);
    var occ = occupancy(trip, bookings);

    var dates = '';
    for (var i = -1; i < 10; i++) {
      var iso = addDays(today(), i), d = parseIso(iso);
      dates += '<button type="button" class="date" data-cdate="' + iso + '" aria-pressed="' + (iso === carrierUi.date) + '"><span>' +
        (i === 0 ? 'сегодня' : WD[d.getDay()]) + '</span><b class="num">' + d.getDate() + '</b><span>' + MON[d.getMonth()] + '</span></button>';
    }
    var tripChips = trips.map(function (t) {
      return '<button type="button" class="chip" data-ctrip="' + t.id + '" aria-pressed="' + (t.id === trip.id) + '">' +
        hm(t.start) + ' ' + esc(stopName(t.stops[0])) + ' → ' + esc(stopName(t.stops[2])) + '</button>';
    }).join('');

    var legStats = [0, 1].map(function (l) {
      var busy = allSeats().filter(function (s) { return occ[s][l]; }).length;
      return '<div class="stat"><b class="num">' + busy + ' / ' + allSeats().length + '</b><span>занято ' + esc(stopName(trip.stops[l])) + '–' + esc(stopName(trip.stops[l + 1])) + '</span></div>';
    }).join('');
    var online = bookings.filter(function (b) { return b.status === 'paid'; })
      .reduce(function (s, b) { return s + priceOf(b.from, b.to) * b.seats.length; }, 0);
    var byPhone = bookings.filter(function (b) { return b.status === 'phone'; })
      .reduce(function (s, b) { return s + b.seats.length; }, 0);

    var tabs = [['seats', 'Места'], ['list', 'Брони'], ['sheet', 'Ведомость']].map(function (t) {
      return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (carrierUi.tab === t[0]) + '">' + t[1] + '</button>';
    }).join('');

    var body = '';
    if (carrierUi.tab === 'seats') body = carrierSeats(trip, occ);
    else if (carrierUi.tab === 'list') body = carrierList(trip, bookings);
    else body = carrierSheet(trip, bookings);

    app.innerHTML =
      '<h1>Страница перевозчика</h1>' +
      '<p class="note warn">Демо: открыта без пароля. В боевой версии сюда входят по логину, а водитель видит только свои рейсы.</p>' +
      '<h2>Дата</h2><div class="dates">' + dates + '</div>' +
      '<h2>Рейс</h2><div class="chips">' + tripChips + '</div>' +
      '<div class="trip" style="margin-top:12px">' + timelineHtml(trip, trip.stops[0], trip.stops[2]) + crewHtml(trip) + '</div>' +
      '<div class="panel stack" style="margin-top:12px"><div><p class="label">Водитель на этот рейс (его телефон увидят пассажиры)</p><div class="chips">' +
      allDrivers().map(function (d) {
        return '<button type="button" class="chip" data-driver="' + esc(d.id) + '" aria-pressed="' + (d.id === trip.crew.driverId) + '">' + esc(d.name) + '</button>';
      }).join('') + '</div></div>' +
      '<details><summary class="small" style="cursor:pointer;color:var(--accent)">Добавить нового водителя</summary><div class="stack" style="margin-top:10px">' +
      '<div class="field"><label for="dname">Имя и фамилия</label><input id="dname" autocomplete="off" placeholder="Например, Тест Тестов"></div>' +
      '<div class="field"><label for="dphone">Телефон</label><input id="dphone" type="tel" autocomplete="off" placeholder="+7 900 000-00-00"></div>' +
      '<button type="button" class="btn btn-ghost" data-adddriver>Добавить водителя</button></div></details></div>' +
      '<div class="stats" style="margin-top:12px">' + legStats +
      '<div class="stat"><b class="num">' + money(online) + '</b><span>оплачено онлайн (тест)</span></div>' +
      '<div class="stat"><b class="num">' + byPhone + '</b><span>' + seatWord(byPhone) + ' продано по телефону</span></div></div>' +
      '<div class="tabs" role="tablist">' + tabs + '</div>' + body +
      '<div class="noprint" style="margin-top:28px"><button type="button" class="btn btn-danger btn-block" data-reset>Сбросить демо: удалить все брони в этом браузере</button></div>';

    app.onclick = function (e) {
      var t = e.target.closest('button'); if (!t) return;
      var y = window.scrollY;
      if (t.dataset.cdate) { carrierUi.date = t.dataset.cdate; carrierUi.tripId = null; carrierUi.seat = null; }
      else if (t.dataset.ctrip) { carrierUi.tripId = t.dataset.ctrip; carrierUi.seat = null; }
      else if (t.dataset.tab) { carrierUi.tab = t.dataset.tab; }
      else if (t.dataset.seat) {
        carrierUi.seat = +t.dataset.seat === carrierUi.seat ? null : +t.dataset.seat;
        carrierUi.from = null; carrierUi.to = null;
      }
      else if (t.dataset.cfrom) { carrierUi.from = t.dataset.cfrom; carrierUi.to = null; }
      else if (t.dataset.cto) { carrierUi.to = t.dataset.cto; }
      else if (t.hasAttribute('data-close')) {
        var nm = (document.getElementById('cname') || {}).value || 'Продано по телефону';
        var ph = (document.getElementById('cphone') || {}).value || '';
        state.bookings.push({
          id: 'p' + Date.now(), code: newCode(), tripId: trip.id, from: carrierUi.from, to: carrierUi.to,
          seats: [carrierUi.seat], name: nm.trim() || 'Продано по телефону', phone: ph.trim(), status: 'phone', source: 'phone', createdAt: Date.now()
        });
        save(); carrierUi.from = null; carrierUi.to = null;
      }
      else if (t.dataset.open) {
        var bid = t.dataset.open;
        if (bid.indexOf('seed-') === 0) { state.removedSeeds = state.removedSeeds || {}; state.removedSeeds[bid] = 1; }
        else state.bookings = state.bookings.filter(function (b) { return b.id !== bid; });
        save();
      }
      else if (t.dataset.driver) {
        state.driverOverride = state.driverOverride || {}; state.driverOverride[trip.id] = t.dataset.driver; save();
      }
      else if (t.hasAttribute('data-adddriver')) {
        var dn = (document.getElementById('dname').value || '').trim(), dp = (document.getElementById('dphone').value || '').trim();
        if (dn.length < 2 || dp.replace(/\D/g, '').length < 10) { var dl = document.getElementById('dphone'); dl.setCustomValidity('Введите имя и телефон (не меньше 10 цифр)'); dl.reportValidity(); dl.setCustomValidity(''); return; }
        var nd = { id: 'x' + Date.now(), name: dn, phone: dp };
        state.extraDrivers = (state.extraDrivers || []).concat([nd]);
        state.driverOverride = state.driverOverride || {}; state.driverOverride[trip.id] = nd.id; save();
      }
      else if (t.hasAttribute('data-print')) { window.print(); return; }
      else if (t.hasAttribute('data-reset')) {
        if (!confirm('Удалить все демо-брони, сделанные в этом браузере?')) return;
        state = emptyState(); save(); carrierUi.seat = null;
      }
      else return;
      viewCarrier(null); window.scrollTo(0, y);
    };
    app.onchange = function (e) {
      if (e.target.dataset.board) {
        state.boarded[e.target.dataset.board] = e.target.checked; save();
      }
    };
  }

  function carrierSeats(trip, occ) {
    var html = '<p class="small muted">Нажмите на место, чтобы увидеть, кто его занимает, или закрыть его вручную, если продали по телефону.</p>' +
      vanHtml({ trip: trip, occ: occ, legs: [0, 1], selected: [], carrier: true, picked: carrierUi.seat }) + legendHtml(true);
    var s = carrierUi.seat;
    if (!s) return html;
    var cells = occ[s];
    var legRows = [0, 1].map(function (l) {
      var b = cells[l];
      var who = !b ? '<span class="free">свободно</span>' :
        '<span>' + esc(b.name) + (b.status === 'phone' ? ' <span class="tag phone">телефон</span>' : (b.status === 'held' ? ' <span class="tag held">ждёт оплаты</span>' : '')) + '</span>';
      return '<div><span>' + esc(stopName(trip.stops[l])) + ' → ' + esc(stopName(trip.stops[l + 1])) + '</span>' + who + '</div>';
    }).join('');
    // свободные участки для закрытия
    var freeLegs = [0, 1].filter(function (l) { return !cells[l]; });
    var closeHtml = '';
    if (freeLegs.length) {
      var fromOpts = trip.stops.slice(0, 2).filter(function (sid, k) { return !cells[k]; });
      var cf = carrierUi.from;
      var toOpts = [];
      if (cf) {
        var k0 = trip.stops.indexOf(cf);
        for (var k = k0; k < 2 && !cells[k]; k++) toOpts.push(trip.stops[k + 1]);
      }
      closeHtml = '<h3>Закрыть место ' + s + ' (продано по телефону)</h3>' +
        '<p class="label">Откуда</p><div class="chips">' + fromOpts.map(function (sid) {
          return '<button type="button" class="chip" data-cfrom="' + sid + '" aria-pressed="' + (sid === cf) + '">' + esc(stopName(sid)) + '</button>';
        }).join('') + '</div>' +
        (cf ? '<p class="label" style="margin-top:10px">Куда</p><div class="chips">' + toOpts.map(function (sid) {
          return '<button type="button" class="chip" data-cto="' + sid + '" aria-pressed="' + (sid === carrierUi.to) + '">' + esc(stopName(sid)) + '</button>';
        }).join('') + '</div>' : '') +
        (cf && carrierUi.to ? '<div class="stack" style="margin-top:12px"><div class="field"><label for="cname">Пассажир (необязательно)</label><input id="cname" autocomplete="off" placeholder="Например, Тест Т."></div>' +
          '<div class="field"><label for="cphone">Телефон (необязательно)</label><input id="cphone" type="tel" autocomplete="off" placeholder="+7 900 000-00-00"></div>' +
          '<button type="button" class="btn btn-gold btn-block" data-close>Закрыть место ' + s + ': ' + esc(stopName(cf)) + ' → ' + esc(stopName(carrierUi.to)) + '</button></div>' : '');
    }
    var openBtns = [];
    [0, 1].forEach(function (l) {
      var b = cells[l];
      if (b && b.status === 'phone' && openBtns.indexOf(b.id) < 0) openBtns.push(b.id);
    });
    var openHtml = openBtns.map(function (bid) {
      return '<button type="button" class="btn btn-ghost btn-block" data-open="' + bid + '">Снять ручное закрытие места ' + s + '</button>';
    }).join('');
    return html + '<div class="panel seatpanel"><h3 style="margin-top:0">Место ' + s + '</h3><div class="legs">' + legRows + '</div>' + openHtml + closeHtml + '</div>';
  }

  function statusTag(b) {
    if (b.status === 'phone') return '<span class="tag phone">по телефону</span>';
    if (b.status === 'held') return '<span class="tag held">ждёт оплаты</span>';
    return '<span class="tag">оплачено' + (b.source === 'site' ? ', с сайта' : '') + '</span>';
  }
  function carrierList(trip, bookings) {
    if (!bookings.length) return '<p class="muted">На этот рейс броней пока нет.</p>';
    var sorted = bookings.slice().sort(function (a, b) { return a.seats[0] - b.seats[0]; });
    return '<ul class="blist">' + sorted.map(function (b) {
      return '<li><div class="top"><span>Место ' + b.seats.join(', ') + ' · ' + esc(b.code) + '</span>' + statusTag(b) + '</div>' +
        '<div>' + esc(stopName(b.from)) + ' → ' + esc(stopName(b.to)) + ', ' + money(priceOf(b.from, b.to) * b.seats.length) + '</div>' +
        '<div class="small muted">' + esc(b.name) + (b.phone ? ', ' + esc(b.phone) : '') + '</div></li>';
    }).join('') + '</ul>';
  }
  function carrierSheet(trip, bookings) {
    var html = '<div class="noprint" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><p class="small muted" style="margin:0">Список для водителя по остановкам. Отметки «сел» сохраняются в этом браузере.</p>' +
      '<button type="button" class="btn btn-ghost" data-print>Печать</button></div>' +
      '<p class="small">Рейс ' + dateLabel(trip.date) + ', ' + hm(trip.start) + ', ' + esc(DATA.directions[trip.dir].label) + '. Водитель ' + esc(trip.crew.driver) + ', ' + esc(trip.crew.plate) + '.</p>';
    trip.stops.forEach(function (sid, k) {
      var board = bookings.filter(function (b) { return b.from === sid && b.status !== 'held'; });
      var out = bookings.filter(function (b) { return b.to === sid && b.status !== 'held'; });
      if (!board.length && !out.length) return;
      var t = k === 0 ? clock(trip, at(trip, 0, 'dep')).t : clock(trip, at(trip, k, 'arr')).t;
      html += '<div class="sheet-stop panel"><h3><span>' + esc(stopName(sid)) + '</span><span class="num">' + t + '</span></h3>';
      out.sort(function (a, b) { return a.seats[0] - b.seats[0]; }).forEach(function (b) {
        html += '<div class="sheet-row out"><span class="s num">' + b.seats.join(',') + '</span><span>Выходит: ' + esc(b.name) + '<br><span class="small muted">ехал из ' + esc(stopName(b.from)) + '</span></span><span></span></div>';
      });
      board.sort(function (a, b) { return a.seats[0] - b.seats[0]; }).forEach(function (b) {
        html += '<div class="sheet-row"><span class="s num">' + b.seats.join(',') + '</span><span>' + esc(b.name) +
          (b.phone ? '<br><a class="small" href="tel:' + esc(b.phone.replace(/[^\d+]/g, '')) + '">' + esc(b.phone) + '</a>' : '') +
          '<br><span class="small muted">до ' + esc(stopName(b.to)) + (b.status === 'phone' ? ', оплата водителю' : ', оплачено') + '</span></span>' +
          '<label class="small"><input type="checkbox" data-board="' + b.id + '"' + (state.boarded[b.id] ? ' checked' : '') + '> сел</label></div>';
      });
      html += '</div>';
    });
    return html;
  }

  // ---------- Правила (тестовые) ----------
  function viewRules() {
    setNav('rules');
    var pts = DATA.schedule.map(function (s) {
      var trip = makeTrip(today(), s);
      return '<h3>' + esc(DATA.directions[s.direction].label) + ', ' + esc(daysText(s.direction)) + '</h3><dl class="rules">' +
        trip.stops.map(function (sid) {
          return '<dt>' + esc(stopName(sid)) + '</dt><dd>' + pointsOf(trip, sid).map(function (p) {
            return (p.t != null ? hm(trip.start + p.t) + ' — ' : '') + esc(p.name);
          }).join('<br>') + '</dd>';
        }).join('') + '</dl>';
    }).join('');
    app.innerHTML = '<h1>Правила поездки</h1><p class="note warn">Тестовый текст для обсуждения. Настоящие правила утверждает перевозчик и проверяет юрист.</p>' +
      '<h2>Расписание и точки посадки</h2><p class="small muted">Время местное, во всех трёх городах одинаковое.</p>' + pts +
      '<h2>Отмена и возврат</h2><dl class="rules">' +
      '<dt>Отмена заранее</dt><dd>Вариант для обсуждения: полный возврат при отмене не позже чем за 2 часа до отправления, позже — с удержанием.</dd>' +
      '<dt>Как отменить</dt><dd>Кнопкой в сообщении бота или звонком перевозчику.</dd>' +
      '<dt>Опоздание</dt><dd>Водитель ждёт не дольше 10 минут, потом место считается свободным.</dd></dl>' +
      '<h2>Багаж</h2><dl class="rules"><dt>Бесплатно</dt><dd>Одна сумка до 20 кг и ручная кладь.</dd>' +
      '<dt>Сверх нормы</dt><dd>По договорённости с водителем, при наличии места.</dd></dl>' +
      '<h2>Дети</h2><dl class="rules"><dt>Место</dt><dd>Каждому ребёнку нужно отдельное место; правила перевозки детей (удерживающие устройства, скидки) — уточнить перед запуском.</dd></dl>' +
      '<h2>Перевозчик</h2><p>' + esc(DATA.carrier.name) + (DATA.carrier.license ? '<br>' + esc(DATA.carrier.license) : '') + '<br><span class="muted">Телефон в демо тестовый: ' + esc(DATA.carrier.phone) + '</span></p>';
    app.onclick = null;
  }

  function notFound() {
    app.innerHTML = '<h1>Страница не найдена</h1><p class="lead">Возможно, бронь была сделана в другом браузере: в демо брони хранятся только на этом устройстве.</p><a class="btn btn-primary" href="#/">К рейсам</a>';
    app.onclick = null;
  }

  // ---------- Роутер ----------
  function render() {
    clearInterval(timerId);
    app.oninput = null; app.onchange = null;
    var h = location.hash.replace(/^#/, '') || '/';
    var qi = h.indexOf('?');
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var q = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
    var p = path.split('/').filter(Boolean);
    if (!p.length) viewHome();
    else if (p[0] === 'trip' && p[1]) viewTrip(p[1], q);
    else if (p[0] === 'pay' && p[1]) viewPay(p[1]);
    else if (p[0] === 'done' && p[1]) viewDone(p[1]);
    else if (p[0] === 'carrier') viewCarrier(q);
    else if (p[0] === 'rules') viewRules();
    else notFound();
  }
  var lastPath = null;
  window.addEventListener('hashchange', function () {
    var path = location.hash.split('?')[0];
    render();
    if (path !== lastPath) { window.scrollTo(0, 0); lastPath = path; }
  });

  fetch('data/route.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      DATA = d;
      document.getElementById('carrierName').textContent = d.carrier.name;
      lastPath = location.hash.split('?')[0];
      render();
    })
    .catch(function (e) {
      app.innerHTML = '<h1>Не удалось загрузить расписание</h1><p class="lead">Файл data/route.json не открылся (' + esc(e.message) +
        '). Если вы открыли index.html прямо с компьютера, откройте сайт по адресу GitHub Pages.</p>';
    });
})();
