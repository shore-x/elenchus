import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createCapabilityBundle,
  type CapabilityProvider,
  type CapabilitySnapshot,
  type InstalledSkill,
  type SkillInstallResult,
  type SkillInstaller,
} from "../../core/skills.js";
import { LocalSkillLoader, type LocalSkillLoaderOptions } from "./local-skill-loader.js";

export interface LocalSkillRuntimeOptions extends LocalSkillLoaderOptions {}

export class LocalSkillRuntime implements CapabilityProvider, SkillInstaller {
  private readonly loader: LocalSkillLoader;
  private readonly runDirectory: string;
  private readonly skillsRoot: string;
  private readonly stagingRoot: string;
  private snapshot: CapabilitySnapshot;
  private epochCounter = 0;
  private installQueue: Promise<void> = Promise.resolve();

  constructor(options: LocalSkillRuntimeOptions) {
    this.loader = new LocalSkillLoader(options);
    this.runDirectory = resolve(options.runDirectory);
    this.skillsRoot = this.loader.getSkillsRoot();
    this.stagingRoot = join(this.runDirectory, ".elenchus", "skill-staging");
    this.snapshot = this.buildSnapshot(this.loader.loadInstalledSkills());
  }

  getSnapshot(): CapabilitySnapshot {
    return this.snapshot;
  }

  refresh(): CapabilitySnapshot {
    this.snapshot = this.buildSnapshot(this.loader.loadInstalledSkills());
    return this.snapshot;
  }

  async installFromLocalDirectory(sourcePath: string): Promise<SkillInstallResult> {
    return this.enqueueInstallation(() => this.performInstallFromLocalDirectory(sourcePath));
  }

  private buildSnapshot(skills: readonly InstalledSkill[]): CapabilitySnapshot {
    const bundle = createCapabilityBundle(skills);
    return {
      epoch: this.epochCounter++,
      bundle,
      bindings: bundle.getSkillBindings(),
    };
  }

  private enqueueInstallation<T>(task: () => Promise<T>): Promise<T> {
    const nextTask = this.installQueue.then(task, task);
    this.installQueue = nextTask.then(() => undefined, () => undefined);
    return nextTask;
  }

  private async performInstallFromLocalDirectory(sourcePath: string): Promise<SkillInstallResult> {
    const resolvedSource = resolve(sourcePath);
    let sourceStats;
    try {
      sourceStats = await stat(resolvedSource);
    } catch {
      return { ok: false, message: `Skill installation failed: source directory ${resolvedSource} does not exist.` };
    }

    if (!sourceStats.isDirectory()) {
      return { ok: false, message: `Skill installation failed: source path ${resolvedSource} is not a directory.` };
    }

    let sourceSkill: InstalledSkill;
    try {
      sourceSkill = this.loader.loadSkillFromDirectory(resolvedSource);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }

    const existingBinding = this.snapshot.bindings.find((binding) => binding.skillId === sourceSkill.id);
    if (existingBinding) {
      return {
        ok: false,
        message: `Skill installation failed: skill ${sourceSkill.id} is already installed at ${existingBinding.sourcePath}. Hot install currently does not support overwrite or upgrade.`,
      };
    }

    await mkdir(this.skillsRoot, { recursive: true });
    await mkdir(this.stagingRoot, { recursive: true });

    const targetDirectory = join(this.skillsRoot, sourceSkill.id);
    if (resolvedSource === targetDirectory) {
      return {
        ok: false,
        message: `Skill installation failed: source directory ${resolvedSource} is already the managed install location for ${sourceSkill.id}.`,
      };
    }
    if (existsSync(targetDirectory)) {
      return {
        ok: false,
        message: `Skill installation failed: target directory ${targetDirectory} already exists. Hot install currently does not support overwrite or upgrade.`,
      };
    }

    const stagingDirectory = join(this.stagingRoot, `${sourceSkill.id}-${randomUUID()}`);

    try {
      await cp(resolvedSource, stagingDirectory, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      this.loader.loadSkillFromDirectory(stagingDirectory);
      await rename(stagingDirectory, targetDirectory);
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      return {
        ok: false,
        message: error instanceof Error
          ? `Skill installation failed while copying ${resolvedSource}: ${error.message}`
          : `Skill installation failed while copying ${resolvedSource}: ${String(error)}`,
      };
    }

    const snapshot = this.refresh();
    const installedBinding = snapshot.bindings.find((binding) => binding.skillId === sourceSkill.id);
    if (!installedBinding) {
      return {
        ok: false,
        message: `Skill installation failed: skill ${sourceSkill.id} was copied but not visible after capability refresh.`,
      };
    }

    return {
      ok: true,
      message: `Installed skill ${sourceSkill.id} from ${resolvedSource}. The new skill capability set is available from the next turn.`,
      installedBinding,
      epoch: snapshot.epoch,
    };
  }
}
