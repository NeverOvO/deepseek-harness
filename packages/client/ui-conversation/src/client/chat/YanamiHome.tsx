import css from './YanamiHome.module.css'

export interface YanamiHomeProps {
  cwd?: string
  sessionCount?: number
}

const MODES = [
  { key: 'Do', title: '执行模式', note: '直接理解目标并推进实现', tone: 'blue' },
  { key: 'Spec', title: '规格模式', note: '明确范围、边界与验收标准', tone: 'sky' },
  { key: 'Plan', title: '计划模式', note: '拆解路径、依赖与风险', tone: 'mint' },
  { key: 'Review', title: '复核模式', note: '检查缺陷、回归与遗漏', tone: 'teal' },
  { key: 'Ship', title: '交付模式', note: '测试、构建与发布准备', tone: 'lemon' },
] as const

function projectName(cwd?: string): string {
  if (cwd === undefined || cwd.trim() === '') return '选择工作区后载入'
  const segments = cwd.replaceAll('\\', '/').split('/').filter(Boolean)
  return segments.at(-1) ?? cwd
}

/** Blank-session landing surface for Yanami Workbench. */
export function YanamiHome({ cwd, sessionCount }: YanamiHomeProps = {}) {
  const project = projectName(cwd)

  return (
    <section className={css.home} aria-label="八奈见工作台首页">
      <header className={css.hero}>
        <div className={css.heroCopy}>
          <div className={css.eyebrow}>YANAMI WORKBENCH · 八奈见工作台</div>
          <h1>今天想先解决什么？</h1>
          <p>把目标交给工作台。具体任务进入会话后，界面会自动回到高密度的执行视图。</p>
          <div className={css.metaRow}>
            <div className={css.metaCard}>
              <span>当前项目</span>
              <strong title={cwd}>{project}</strong>
            </div>
            <div className={css.metaCard}>
              <span>会话资产</span>
              <strong>{sessionCount ?? '自动整理'}</strong>
            </div>
            <div className={css.metaCard}>
              <span>默认策略</span>
              <strong>Do · 高自治</strong>
            </div>
          </div>
        </div>

        <div className={css.mascot} aria-hidden="true">
          <div className={css.sunDot}>✦</div>
          <div className={css.hairHalo} />
          <div className={css.face}>八</div>
          <div className={css.lemon}>柠</div>
          <span>有问题就交给我吧</span>
        </div>
      </header>

      <section className={css.modeSection}>
        <div className={css.sectionHeading}>
          <div>
            <span className={css.sectionKicker}>五大模式</span>
            <h2>按工作状态组织，而不是按“AI 人设”组织</h2>
          </div>
          <span className={css.phaseTag}>行为层接入中</span>
        </div>
        <div className={css.modeGrid}>
          {MODES.map(mode => (
            <article key={mode.key} className={css.modeCard} data-tone={mode.tone}>
              <div className={css.modeIcon}>{mode.key.slice(0, 1)}</div>
              <div>
                <strong>{mode.key} <span>{mode.title}</span></strong>
                <p>{mode.note}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={css.lowerGrid}>
        <article className={css.panel}>
          <div className={css.panelTitle}>
            <span className={css.panelIcon}>◎</span>
            <div><strong>任务驾驶舱</strong><small>Mission Cockpit</small></div>
          </div>
          <div className={css.progressTrack}><span /></div>
          <p>创建任务后，这里显示目标、阶段、阻塞点和验证进度。</p>
          <div className={css.panelFoot}>目标 → 执行 → 验证 → 交付</div>
        </article>

        <article className={css.panel}>
          <div className={css.panelTitle}>
            <span className={css.panelIcon}>▱</span>
            <div><strong>项目记忆</strong><small>Project Memory</small></div>
          </div>
          <div className={css.memoryLines}>
            <span>Architecture</span><span>Commands</span><span>Decisions</span><span>DoD</span>
          </div>
          <p>后续绑定 Workspace 级长期记忆，让不同会话共享同一项目上下文。</p>
        </article>

        <article className={css.panel}>
          <div className={css.panelTitle}>
            <span className={css.panelIcon}>✓</span>
            <div><strong>证据交付</strong><small>Evidence & Delivery</small></div>
          </div>
          <div className={css.evidenceRows}>
            <span>测试结果</span><b>等待任务</b>
            <span>构建状态</span><b>—</b>
            <span>风险项</span><b>—</b>
          </div>
          <p>完成不是一句“已完成”，而是一组可复核的验证证据。</p>
        </article>

        <article className={css.panelAccent}>
          <div className={css.notePaper}>
            <small>今日小记</small>
            <strong>复杂的问题，<br />也可以拆成简单的阶段。</strong>
            <span>♡</span>
          </div>
          <div className={css.citrus}>◌</div>
        </article>
      </section>
    </section>
  )
}
