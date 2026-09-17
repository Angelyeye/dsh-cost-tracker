# Peak and Valley "Circular Dial" Design Scheme



> Plugin: `dsh-cost-tracker` · Goal: To transform the **classic (two rows)** option in the "Time Period Bar Style" dropdown into a **hollow ring** divided by 24 hours.

Preview page: `docs/peak-dial-preview.html` (has been verified by rendering each item in a browser).



---



## 1. Requirements



- The existing "Classic (Two Lines)" is a fixed-width linear track + two lines of text (chip / countdown), which cannot intuitively show the distribution of peaks and valleys throughout the day and the current location.

- We hope to change it to a **hollow circular (ring/donut-shaped) dial**, divided into 24 hours;

  - **Orange** = Peak hours (weekdays 9:00-12:00, 14:00-18:00)

  - **Blue** = Price-off period (other times)

  - **Weekend** = All-day price (overall blue)

  - A pointer points to the "current moment", and the center of the circle displays the "current phase + countdown".



## 2. Design Considerations



### 2.1 Styling

- **SVG Ring**: A blue base ring that covers 24 hours, then orange arcs (`[9,12]`, `[14,18]`) are superimposed according to the peak window.

- **Coordinate system:** `0:00` at the top, `6:00` on the right, `12:00` at the bottom, and `18:00` on the left (standard 24-hour clock). A scale mark every 3 hours.

- **Pointer**: A thin rod pointing from the center to the current time + the top dot, rotating with `now`.

- **Center Content**: Current phase keyword (`peak hours/low price hours/weekend full valley`) + countdown (e.g., "low price in 1 hour and 30 minutes").

- **Proportional scaling**: Using SVG `viewBox`, the same code can adapt to both wide and narrow rail widths.



### 2.2 Color Scheme (using the existing color palette of the plugin)

| Uses | Value |

| --- | --- |

| Peak Orange | `#ff9800` (corresponding to `.cost-ps-peakseg`) |

Affordable Blue | `--dsw-alias-state-business-primary, #4176e6` |

| Weekend Green | `#34a853` |

| Primary/Secondary/Weak Text| `#171a1f / #5b6472 / #9ca3af` |



### 2.3 Data Scope

- The backend already has a window with the same scope as `isPeak / peakPhaseAt`: `pricing.js`'s `PEAK_HOUR_WINDOWS = [{start:9,end:12},{start:14,end:18}]`.

- **New Feature**: In `index.js`'s `peakSnapshot()`, a structured window array `peakHours: PEAK_HOUR_WINDOWS` is sent to the front end. The front end uses this array to draw arcs, avoiding hardcoding the window on the front end and ensuring synchronization with the billing standard.

- The weekend determination follows `snap.phase.weekend`: if true, **no orange arc is drawn**, and the entire ring is blue.



## 3. Implement the changes (surface)



| File | Changes |

| --- | --- |

| `index.js` | `peakSnapshot()` adds `peakHours: PEAK_HOUR_WINDOWS`; imports `PEAK_HOUR_WINDOWS` from `./pricing.js`.

| `config.js` | Only comments have been updated; the value of `peakStyle` remains `classic`, but the semantics have been changed to "circular dial", and `compact` remains unchanged (old configurations do not need to be migrated).

| `client.js` | ① Added the `PeakDial` SVG component and the `cost-ps-ring*` style; ② Rewrote the `classic` branch to this ring; ③ Changed the dropdown label to "Ring Clock (24h)"; ④ Set the panel description text to synchronize. |



### 3.1 Key snippets of `client.js`



```js

// 24-hour circular dial: The bottom ring is entirely blue, with orange arcs superimposed on the peak window, and the hands point to the current time.

function PeakDial(props) {

  const p = props.phase;                       // { inPeak, weekend, nextAtMs, ... }

  const now = props.now;

  const windows = props.windows || [{start:9,end:12},{start:14,end:18}];

  const size = props.size || 150;

  const CX = 90, CY = 90, R = 62, SW = 18;     // viewBox 180

  const deg = (h) => h * 15; // 0:00 Top, clockwise

  const polar = (d, r) => [CX + r*Math.sin(d*Math.PI/180), CY - r*Math.cos(d*Math.PI/180)];

  const arc = (a, b) => { const s = polar(deg(a), R), e2 = polar(deg(b), R);

    return `M ${s[0]} ${s[1]} A ${R} ${R} 0 ${(b-a)%360>180?1:0} 1 ${e2[0]} ${e2[1]}`; };

  const minuteOfDay = /* from now (Beijing) */;

  const marker = polar(minuteOfDay / 1440 * 360, R);

  const color = p.weekend ? GREEN : p.inPeak ? AMBER : BLUE;

  // ... Assemble the SVG: bottom ring + orange arc + tick marks + pointer + center text

}

```



```js

if (style === "classic") { // After modification: circular dial

  return e("div", { className: "cost-ps cost-ps-ring" + wordClass, title: countdown },

    e(PeakDial, { phase: p, windows: snap.peakHours, now }),

    e("div", { className: "cost-ps-ringfoot" },

      e("span", { className: "cost-ps-chip" }, peakWord(p) + " · " + countdown)));

}

```



## 4. Interaction and Boundaries



- **Pointer Real-Time Performance**: `PeakSidebar` already has a `now` timer (10s), and the circular loop reuses `now`, allowing the pointer to move smoothly with the current time.

- **Before and after switching:** The center countdown and the existing `peakCountdown` use the same phase data and have the same caliber.

- **Weekend**: The entire ring is blue, and the center displays "Weekend Valley" without rendering an orange arc.

- **Narrow rail mode**: Still vertical short words, no circular display (keeping the narrow rail simple).

- **Accessibility**: The outer `title` retains the countdown prompt; the ring shape is the main visual element, and the `aria-label` can be added later.



## 5. Acceptance



- [ ] After selecting "Circular Dial (24h)" in the settings panel, the settings panel will display a circular dial with a central phase/countdown.

- [ ] The wide sidebar also displays a circular pattern; the rail remains a vertical bar of short words.

- [ ] During peak/average weekday times, the orange/blue arc and pointer are correct, and the text at the center of the circle changes with the phase.

- [ ] The entire ring is free of orange on weekends, and the center of the circle displays "Weekend Valley".

- [ ] `npm test` (config / pricing / storage) all passed.

