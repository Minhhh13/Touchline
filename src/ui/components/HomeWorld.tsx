import './HomeWorld.css'

/** The two original football environments share small transform-only scenery layers. */
export function HomeWorld({ paused }: { paused: boolean }) {
  return (
    <div className="home-world" data-paused={paused} aria-hidden="true" data-testid="home-world">
      <div className="home-night-sky" />
      <div className="home-cloud-bank home-cloud-bank-far">
        <img src="/art/touchline-clouds.svg" width={960} height={160} alt="" />
        <img src="/art/touchline-clouds.svg" width={960} height={160} alt="" />
      </div>
      <div className="home-cloud-bank home-cloud-bank-near">
        <img src="/art/touchline-clouds.svg" width={960} height={160} alt="" />
        <img src="/art/touchline-clouds.svg" width={960} height={160} alt="" />
      </div>
      <div className="home-ground">
        <img className="home-ground-day" src="/art/touchline-ground-day.webp" width={2172} height={724} alt="" />
        <img className="home-ground-night" src="/art/touchline-ground-night.webp" width={2172} height={724} alt="" />
        <span className="home-lamp home-lamp-left" />
        <span className="home-lamp home-lamp-right" />
        <span className="home-ground-flag home-ground-flag-left"><i /></span>
        <span className="home-ground-flag home-ground-flag-right"><i /></span>
        <div className="home-training-lane home-training-lane-near">
          <span className="home-player-route">
            <span className="home-player"><img src="/art/touchline-player-run.webp" width={1774} height={887} alt="" /></span>
            <svg className="home-training-ball" viewBox="0 0 16 16" width="9" height="9" focusable="false" shapeRendering="crispEdges">
              <path d="M4 0H12V2H14V4H16V12H14V14H12V16H4V14H2V12H0V4H2V2H4Z" fill="#fff3dc" />
              <path d="M6 5H10V10H6ZM4 0H8V2H4ZM14 6H16V10H14ZM4 14H8V16H4Z" fill="#071526" />
            </svg>
          </span>
        </div>
        <div className="home-training-lane home-training-lane-far">
          <span className="home-player-route"><span className="home-player"><img src="/art/touchline-player-run.webp" width={1774} height={887} alt="" /></span></span>
        </div>
      </div>
      <div className="home-tree home-tree-left"><img src="/art/touchline-oak.webp" width={1166} height={1349} alt="" /></div>
      <div className="home-tree home-tree-right"><img src="/art/touchline-oak.webp" width={1166} height={1349} alt="" /></div>
    </div>
  )
}
