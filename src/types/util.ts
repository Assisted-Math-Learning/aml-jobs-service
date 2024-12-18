export interface Board {
  id: number;
  name: {
    en: string;
  };
}

export interface Class {
  id: number;
  name: {
    en: string;
  };
}

export interface Skill {
  id: number;
  name: {
    en: string;
  };
  type: string;
}

export interface SubSkill {
  id: number;
  name: {
    en: string;
  };
}

export interface UniqueValues {
  l1_skill: string[];
  l2_skill: string[];
  l3_skill: string[][];
  board: string[];
  class: string[];
  sub_skills: string[];
  repository_name: string[];
}

export interface Mismatches {
  boards: string[];
  classes: string[];
  repository_name: string[];
  l1_skill: string[];
  l2_skill: string[];
  l3_skill: string[];
  sub_skills: string[];
}
