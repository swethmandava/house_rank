import preschoolsCsv from '../data/san_francisco_preschools_ratings.csv?raw';
import schoolsCsv from '../data/san_francisco_schools_ratings.csv?raw';
import { parseK12SchoolData, parsePreschoolData } from './school-data-parser';

export const sanFranciscoSchools = parseK12SchoolData(schoolsCsv);

export const sanFranciscoPreschools = parsePreschoolData(preschoolsCsv);
