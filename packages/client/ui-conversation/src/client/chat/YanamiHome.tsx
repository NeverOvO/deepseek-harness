import type { KeyboardEvent } from 'react'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import type { YanamiMode } from '@deepseek-ai/dsh-plan-mode/client'
import css from './YanamiHome.module.css'

export interface YanamiHomeProps {
  cwd?: string
  sessionCount?: number
  activeMode?: YanamiMode
  switchingMode?: YanamiMode
  modeError?: string
  onModeSelect?: (mode: YanamiMode) => void
  mission?: GoalProjection | null
}

const MODES = [
  { key: 'do', label: 'Do', title: '执行模式', note: '直接理解目标并推进实现', tone: 'blue' },
  { key: 'spec', label: 'Spec', title: '规格模式', note: '明确范围、边界与验收标准', tone: 'sky' },
  { key: 'plan', label: 'Plan', title: '计划模式', note: '拆解路径、依赖与风险', tone: 'mint' },
  { key: 'review', label: 'Review', title: '复核模式', note: '检查缺陷、回归与遗漏', tone: 'teal' },
  { key: 'ship', label: 'Ship', title: '交付模式', note: '测试、构建与发布准备', tone: 'lemon' },
] as const satisfies readonly {
  key: YanamiMode
  label: string
  title: string
  note: string
  tone: string
}[]

function projectName(cwd?: string): string {
  if (cwd === undefined || cwd.trim() === '') return '选择工作区后载入'
  const segments = cwd.replaceAll('\\', '/').split('/').filter(Boolean)
  return segments.at(-1) ?? cwd
}

function modeLabel(mode?: YanamiMode): string {
  if (mode === undefined) return '加载中'
  return MODES.find(item => item.key === mode)?.label ?? mode
}

function missionProgress(mission?: GoalProjection | null): number {
  if (mission === undefined || mission === null) return 0
  if (mission.goal.phase === 'complete') return 100
  if (mission.goal.maxGoalRounds <= 0) return 0
  return Math.min(100, Math.round((mission.roundsStarted / mission.goal.maxGoalRounds) * 100))
}

function missionPhaseLabel(mission?: GoalProjection | null): string {
  if (mission === undefined || mission === null) return '准备开始'
  switch (mission.goal.phase) {
    case 'active': return '进行中'
    case 'paused': return '已暂停'
    case 'blocked': return '已阻塞'
    case 'complete': return '已完成'
  }
}

/** Blank-session landing surface for Yanami Workbench. */
export function YanamiHome({
  cwd, sessionCount, activeMode, switchingMode, modeError, onModeSelect, mission,
}: YanamiHomeProps = {}) {
  const project = projectName(cwd)
  const modeEnabled = onModeSelect !== undefined
  const missionPercent = missionProgress(mission)
  const missionPhase = mission?.goal.phase ?? 'empty'

  const selectFromKeyboard = (event: KeyboardEvent<HTMLElement>, mode: YanamiMode): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onModeSelect?.(mode)
  }

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
              <span>当前策略</span>
              <strong>{modeLabel(activeMode)} · 高自治</strong>
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
          <span className={css.phaseTag}>
            {switchingMode !== undefined
              ? `${modeLabel(switchingMode)} · 切换中`
              : activeMode !== undefined
                ? `${modeLabel(activeMode)} · 已启用`
                : modeEnabled ? 'Mode · 同步中' : '选择工作区后启用'}
          </span>
        </div>
        <div className={css.modeGrid}>
          {MODES.map(mode => {
            const active = activeMode === mode.key
            const switching = switchingMode === mode.key
            const disabled = !modeEnabled || switchingMode !== undefined
            return (
              <article
                key={mode.key}
                className={css.modeCard}
                data-tone={mode.tone}
                data-active={active ? 'true' : 'false'}
                data-switching={switching ? 'true' : 'false'}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-pressed={active}
                aria-disabled={disabled}
                onClick={disabled ? undefined : () => { onModeSelect(mode.key) }}
                onKeyDown={disabled ? undefined : event => { selectFromKeyboard(event, mode.key) }}
              >
                <div className={css.modeIcon}>{switching ? '…' : mode.label.slice(0, 1)}</div>
                <div>
                  <strong>{mode.label} <span>{mode.title}</span></strong>
                  <p>{mode.note}</p>
                </div>
              </article>
            )
          })}
        </div>
        {modeError !== undefined && <p className={css.modeError} role="status">{modeError}</p>}
      </section>

      <section className={css.lowerGrid}>
        <article className={css.panel} data-mission-phase={missionPhase}>
          <div className={css.panelTitle}>
            <span className={css.panelIcon}>◎</span>
            <div><strong>任务驾驶舱</strong><small>Mission Cockpit</small></div>
            <span className={css.missionStatus}>{missionPhaseLabel(mission)}</span>
          </div>
          <div
            className={css.progressTrack}
            role="progressbar"
            aria-label={mission?.goal.phase === 'complete' ? '任务完成度' : 'Goal 执行轮次预算使用率'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={missionPercent}
          >
            <span style={{ width: `${missionPercent}%` }} />
          </div>
          {mission === undefined || mission === null
            ? <p>创建 Goal 后，这里会实时显示目标、生命周期、阻塞原因与执行轮次。</p>
            : (
              <>
                <p className={css.missionObjective} title={mission.goal.objective}>{mission.goal.objective}</p>
                {mission.goal.phase === 'blocked' && mission.goal.blockedReason !== undefined && (
                  <p className={css.missionReason} role="status">
                    <strong>阻塞：</strong>{mission.goal.blockedReason.message}
                  </p>
                )}
              </>
            )}
          <div className={css.panelFoot}>
            {mission === undefined || mission === null
              ? '目标 → 执行 → 验证 → 交付'
              : mission.goal.phase === 'complete'
                ? `已完成 · 共启动 ${mission.roundsStarted} 轮`
                : `执行轮次 ${mission.roundsStarted} / ${mission.goal.maxGoalRounds} · ${missionPercent}% 预算已用`}
          </div>
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
